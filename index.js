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

function validateRequest(req, options, callback) {
  console.log(">> Calling validateRequest.");
  try {
    // Validating options object data.
    if (typeof options !== "object") {
      return callback("Enter the correct options which type is object.");
    }

    let auditData = {};
    auditData.APPNAME = "";
    auditData.FUNCTIONNAME = "";
    auditData.IPADDRESS = "";
    auditData.PARAMETER = "";
    auditData.HOSTDNS = "";
    auditData.ENVIRONMENT = "";
    auditData.APIURL = "";

    if (!options.VCAP_APPLICATION) {
      throw "Please enter the VCAP_APPLICATION object in options.";
    }

    if (!options.VCAP_SERVICES) {
      throw "Please enter the VCAP_SERVICES object in options.";
    }

    if (!options.APP_XSA_JOBS) {
      throw "Please enter the app xsa jobs ups object in options.";
    } else {
      auditData.APP_XSA_JOBS = options.APP_XSA_JOBS;
    }

    if (!options.SMTP_EMAIL_UPS) {
      throw "Please enter the smtp email ups object in options.";
    } else {
      auditData.SMTP_EMAIL_UPS = options.SMTP_EMAIL_UPS;
    }

    if (!options.SERVICES) {
      throw "Please enter the SERVICES object in options.";
    } else {
      auditData.SERVICES = options.SERVICES;
    }

    // Getting application name.
    if (options.APPNAME) {
      auditData.APPNAME = options.APPNAME;
    } else if (options.VCAP_APPLICATION) {
      auditData.APPNAME = options.VCAP_APPLICATION.application_name.split("-")[0].toUpperCase();
    } else {
      throw "Not able to get the APPNAME from VCAP_APPLICATION object or options object.";
    }

    // Getting API name from request object.
    if (options.FUNCTIONNAME) {
      auditData.FUNCTIONNAME = options.FUNCTIONNAME;
    } else if (req) {
      auditData.FUNCTIONNAME = (url.parse(req.url).pathname).split("/").pop() || ("/");
    } else {
      throw "Not able to get the FUNCTIONNAME from req object or options object.";
    }

    // Getting IPADDRESS from request object.
    if (options.IPADDRESS) {
      auditData.IPADDRESS = options.IPADDRESS;
    } else if (req) {
      auditData.IPADDRESS = (req.header("x-forwarded-for")) ? req.header("x-forwarded-for") : req.connection.remoteAddress;
    } else {
      throw "Not able to get the IPADDRESS from req object or options object.";
    }

    // Getting request body from request object.
    if (options.PARAMETER) {
      auditData.PARAMETER = options.PARAMETER;
    } else if (req) {
      auditData.PARAMETER = req.body ? req.body : {};
    } else {
      throw "Not able to get the PARAMETER from req object or options object.";
    }

    // Getting Host Dns name from request object.
    if (options.HOSTDNS) {
      auditData.HOSTDNS = options.HOSTDNS;
    } else if (req) {
      auditData.HOSTDNS = req.headers.host;
    } else {
      throw "Not able to get the HOSTDNS from req object or options object.";
    }

    // Getting ENVIRONMENT name from service object.
    if (options.ENVIRONMENT) {
      auditData.ENVIRONMENT = options.ENVIRONMENT;
    } else if (options.VCAP_SERVICES) {
      auditData.ENVIRONMENT = options.VCAP_SERVICES.hana[0].credentials.tenant_name;
    } else {
      throw "Not able to get the ENVIRONMENT from service object or options object.";
    }

    // Checking Application Enable Flag in Global Varibale Table
    checkApplicationEnableFlag(auditData, (flagError, flagResp) => {
      if (flagError) {
        auditData.APP_ENABLE_FLAG = false;
        callback(flagError);
      } else if (!flagResp) {
        auditData.APP_ENABLE_FLAG = false;
        return callback(null, {
          "APP_ENABLE_FLAG": flagResp
        });
      } else {
        auditData.APP_ENABLE_FLAG = true;
        try {
          // Creating url to call the app integration framework API for validating request.
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
          axios.post(auditData.APIURL, {
              "auditData": auditData
            }, config)
            .then(function(resp) {
              console.log("Successfully validated request in App Integration Management Framework.");
              //auditData.APP_ENABLE_FLAG = (resp && resp.data && resp.data.APP_ENABLE_FLAG) ? resp.data.APP_ENABLE_FLAG : false;
              auditData.REQUESTID = (resp && resp.data && resp.data.REQUESTID) ? resp.data.REQUESTID : null;
              callback(null, {
                "APP_ENABLE_FLAG": auditData.APP_ENABLE_FLAG,
                "REQUESTID": auditData.REQUESTID
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
                    "APP_ENABLE_FLAG": auditData.APP_ENABLE_FLAG
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
          callback(throwingError);
        }
      }
    });
  } catch (throwingError) {
    callback(throwingError);
  }
}

function checkApplicationEnableFlag(auditData, callback) {
  console.log("##Calling checkApplicationEnableFlag.");
  try {
    var query = `select "VARIABLE_VALUE" from "EBI"."T_IM_GLOBAL_VARIABLE"
    where ("APP_NAME"='${auditData.APPNAME}') AND 
    ("FUNCTION_NAME"='GLOBAL') AND
    ("REQUEST_TYPE"='INBOUND') AND
    ("VARIABLE_NAME"='APPLICATION_ENABLE_FLAG')`;

    hdbext.createConnection(auditData.SERVICES.hanaConfig, (connectionError, client) => {
      if (connectionError) {
        client.close();
        console.log("[ERROR]: Connection error in executeQuery function.");
        console.log("[ERROR]:", connectionError);
        callback(connectionError);
      } else {
        client.exec(query, (queryError, result) => {
          if (result && result[0] && result[0].VARIABLE_VALUE) {
            client.close();
            console.log(`[Info]: Successfully Get Application Enable Flag For APPNAME : "${auditData.APPNAME}"`);
            console.log(`[Info]: Application Enable Flag : "${result[0].VARIABLE_VALUE}"`);
            if (result[0].VARIABLE_VALUE == 'TRUE' || result[0].VARIABLE_VALUE == 'true') {
              callback(null, true);
            } else {
              callback(null, false);
            }
          } else {
            client.close();
            console.log(`[ERROR]: While Getting Application Enable Flag For APPNAME  : "${auditData.APPNAME}"`);
            callback(`[ERROR]: While Getting Application Enable Flag For APPNAME : "${auditData.APPNAME}"`);
          }
        });
      }
    });
  } catch (throwingError) {
    console.log("## Error to finding application enable flag for : " + auditData.APPNAME);
    console.log(throwingError);
    callback(throwingError);
  }
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