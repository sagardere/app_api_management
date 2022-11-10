'use strict';

const axios = require("axios");
const url = require("url");
const xsenv = require("@sap/xsenv");
const https = require("https");
const nodemailer = require("nodemailer");
const hdbext = require("@sap/hdbext");
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

async function validateRequest(req, options, callback) {
  console.log("## Calling validateRequest.");
  try {
    if (typeof options !== "object") {
      return callback("Enter the correct options which type is object.");
    }

    let auditData = await validateInputData(req, options);
    let applicationEnableFlag = await checkApplicationEnableFlag(auditData);

    if (!applicationEnableFlag) {
      auditData.APP_ENABLE_FLAG = false;
      return callback(null, {
        "auditData": auditData
      });
    }

    auditData.APP_ENABLE_FLAG = true;
    auditData.APIURL = auditData.APP_XSA_JOBS.APIMgmtHost + auditData.APP_XSA_JOBS.validateInboundRoute;
    let config = {
      httpsAgent,
      method: "post",
      withCredentials: true,
      auth: {
        "username": auditData.APP_XSA_JOBS.userName,
        "password": auditData.APP_XSA_JOBS.password
      },
      headers: {
        "Content-Type": "application/json"
      }
    };

    delete auditData.APP_XSA_JOBS;
    delete auditData.SMTP_EMAIL_UPS;
    delete auditData.SERVICES;

    console.log("### Calling Framework URL : " + auditData.APIURL + " ###");
    console.log(auditData);
    axios.post(auditData.APIURL, {
        "auditData": auditData
      }, config)
      .then(function(resp) {
        console.log("## Successfully validated request in App Integration Management Framework.");
        auditData.REQUESTID = (resp && resp.data && resp.data.REQUESTID) ? resp.data.REQUESTID : null;
        callback(null, {
          "auditData": auditData
        });
      })
      .catch(function(error) {
        auditData.APP_ENABLE_FLAG = false;
        if (error.response && error.response.status && error.response.status > 500) {
          // If App Integration Management Framework is not reachable then skipping validation but executing HANA model and sending email.
          console.log("App Integration Management Framework is Not Reachable, Skipping Validation.");
          console.log("## Status code : " + error.response.status);

          sendFailureEmail(auditData, (emailError, emailResp) => {
            if (emailError) {
              console.log(emailError);
            }
            return callback(null, {
              "auditData": auditData
            });
          });
        } else if (error.response && error.response.data) {
          // If App Integration Management Framework reachable then not executing HANA model, Sending error back to mendix.
          return callback(error.response.data);
        } else {
          // Something happened in setting up the request that triggered an Error
          console.log("## Error to calling framework : " + error.message);
          return callback(error.message);
        }
      });
  } catch (throwingError) {
    console.log('## Inside validateRequest catch.');
    console.log(throwingError);
    callback(throwingError);
  }
}

function validateInputData(req, options) {
  console.log("## Calling validateInputData.");
  return new Promise((resolve, reject) => {
    let temp = {};
    temp.APPNAME = "";
    temp.FUNCTIONNAME = "";
    temp.IPADDRESS = "";
    temp.PARAMETER = "";
    temp.HOSTDNS = "";
    temp.ENVIRONMENT = "";
    temp.APIURL = "";

    if (!options.VCAP_APPLICATION) {
      reject("Please enter the VCAP_APPLICATION object in options.");
    }

    if (!options.VCAP_SERVICES) {
      reject("Please enter the VCAP_SERVICES object in options.");
    }

    if (!options.APP_XSA_JOBS) {
      reject("Please enter the app xsa jobs ups object in options.");
    } else {
      temp.APP_XSA_JOBS = options.APP_XSA_JOBS;
    }

    if (!options.SMTP_EMAIL_UPS) {
      reject("Please enter the smtp email ups object in options.");
    } else {
      temp.SMTP_EMAIL_UPS = options.SMTP_EMAIL_UPS;
    }

    if (!options.SERVICES) {
      reject("Please enter the SERVICES object in options.");
    } else {
      temp.SERVICES = options.SERVICES;
    }

    // Getting application name.
    if (options.APPNAME) {
      temp.APPNAME = options.APPNAME;
    } else if (options.VCAP_APPLICATION) {
      temp.APPNAME = options.VCAP_APPLICATION.application_name.split("-")[0].toUpperCase();
    } else {
      reject("Not able to get the APPNAME from VCAP_APPLICATION object or options object.");
    }

    // Getting API name from request object.
    if (options.FUNCTIONNAME) {
      temp.FUNCTIONNAME = options.FUNCTIONNAME;
    } else if (req) {
      temp.FUNCTIONNAME = (url.parse(req.url).pathname).split("/").pop() || ("/");
    } else {
      reject("Not able to get the FUNCTIONNAME from req object or options object.");
    }

    // Getting IPADDRESS from request object.
    if (options.IPADDRESS) {
      temp.IPADDRESS = options.IPADDRESS;
    } else if (req) {
      temp.IPADDRESS = (req.header("x-forwarded-for")) ? req.header("x-forwarded-for") : req.connection.remoteAddress;
    } else {
      reject("Not able to get the IPADDRESS from req object or options object.");
    }

    // Getting request body from request object.
    if (options.PARAMETER) {
      temp.PARAMETER = options.PARAMETER;
    } else if (req) {
      temp.PARAMETER = req.body ? req.body : {};
    } else {
      reject("Not able to get the PARAMETER from req object or options object.");
    }

    // Getting Host Dns name from request object.
    if (options.HOSTDNS) {
      temp.HOSTDNS = options.HOSTDNS;
    } else if (req) {
      temp.HOSTDNS = req.headers.host;
    } else {
      reject("Not able to get the HOSTDNS from req object or options object.");
    }

    // Getting ENVIRONMENT name from service object.
    if (options.ENVIRONMENT) {
      temp.ENVIRONMENT = options.ENVIRONMENT;
    } else if (options.VCAP_SERVICES) {
      temp.ENVIRONMENT = options.VCAP_SERVICES.hana[0].credentials.tenant_name;
    } else {
      reject("Not able to get the ENVIRONMENT from service object or options object.");
    }
    resolve(temp);
  });
}

function checkApplicationEnableFlag(auditData) {
  console.log("## Calling checkApplicationEnableFlag.");

  return new Promise((resolve, reject) => {
    var query = `select "VARIABLE_VALUE" from "EBI"."T_IM_GLOBAL_VARIABLE"
    where ("APP_NAME"='${auditData.APPNAME}') AND 
    ("FUNCTION_NAME"='GLOBAL') AND
    ("REQUEST_TYPE"='INBOUND') AND
    ("VARIABLE_NAME"='APPLICATION_ENABLE_FLAG')`;

    hdbext.createConnection(auditData.SERVICES.hanaConfig, (connectionError, client) => {
      if (connectionError) {
        client.close();
        console.log("[ERROR]: Connection error in checkApplicationEnableFlag function.");
        reject(connectionError);
      } else {
        client.exec(query, (queryError, result) => {
          client.close();
          if (result && result[0] && result[0].VARIABLE_VALUE) {
            console.log(`## Application Enable Flag For APPNAME : "${auditData.APPNAME}" is : "${result[0].VARIABLE_VALUE}"`);
            if (result[0].VARIABLE_VALUE == 'TRUE' || result[0].VARIABLE_VALUE == 'true') {
              resolve(true);
            } else {
              resolve(false);
            }
          } else {
            reject(`[ERROR]: While Getting Application Enable Flag For APPNAME : "${auditData.APPNAME}"`);
          }
        });
      }
    });
  });
}

// To send the failure email.
function sendFailureEmail(auditData, callback) {
  console.log("## Calling sendFailureEmail.");
  try {
    const transporter = nodemailer.createTransport(auditData.SMTP_EMAIL_UPS);
    console.log(transporter);

    const mailOptions = {
      "from": auditData.APP_XSA_JOBS.mailForm,
      "to": auditData.APP_XSA_JOBS.failureMailTo,
      "subject": `${auditData.ENVIRONMENT} - APP_INTEGRATION_MANAGEMENT: Error for ${auditData.APPNAME} Application`,
      "html": `Dear User,<br/>
                  <br/> <b>APP NAME:</b> ${auditData.APPNAME}
                  <br/> <b>MESSAGE:</b>  Validation of inbound request failed !!
                  <br/> <b>ERROR DETAILS:</b> App Integration Management Framework is Not Reachable.
                  <br/> 
                  <br/> This is a auto generated message, please do not reply
                  <br/> Regards`
    };
    transporter.sendMail(mailOptions, function(error, info) {
      if (error) {
        console.log("## Error to sending email.");
        console.log(error);
      } else {
        console.log("## Email sent to : " + auditData.APP_XSA_JOBS.failureMailTo);
        console.log(info);
      }
      callback(null);
    });
  } catch (throwingError) {
    console.log("## Error to sending email : " + throwingError);
    callback(null);
  }
}

module.exports = validateRequest;