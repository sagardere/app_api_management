'use strict';
const axios = require("axios");
const url = require("url");
const xsenv = require("@sap/xsenv");
const https = require("https");
const nodemailer = require("nodemailer");
const hdbext = require("@sap/hdbext");
const dns = require('dns');
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
const APP_XSA_JOBS = xsenv.getServices({
  "name": "app_xsa_jobs-jobUserCredentials"
}).name;
const SERVICES = xsenv.getServices({
  hanaConfig: {
    tag: "hana"
  }
});
const SMTP_EMAIL_UPS = xsenv.getServices({
  "name": "smtp_email_enterprise"
}).name;
const VCAP_APPLICATION = JSON.parse(process.env.VCAP_APPLICATION);
const VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);
const VALIDATE_ROUTE = APP_XSA_JOBS.APIMgmtHost + APP_XSA_JOBS.validateInboundRoute;
const AUDIT_ROUTE = APP_XSA_JOBS.APIMgmtHost + APP_XSA_JOBS.auditInboundRoute;
const config = {
  httpsAgent,
  method: "post",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  },
  auth: {
    "username": APP_XSA_JOBS.userName,
    "password": APP_XSA_JOBS.password
  }
};

module.exports = {
  validateInboundRequest: async (req, res, next) => {
    console.log("## Calling validateInboundRequest.");
    try {
      let auditData = await getAuditData(req);
      const applicationEnableFlag = await checkApplicationEnableFlag(auditData);
      auditData.APP_ENABLE_FLAG = applicationEnableFlag;
      req.auditData = auditData;

      if (!applicationEnableFlag) {
        console.log("## Application enable flag is FALSE so skkipping api validation part.");
        next();
      } else {
        console.log("## Calling Framework : " + VALIDATE_ROUTE + " ##");
        axios.post(VALIDATE_ROUTE, {
            "auditData": auditData
          }, config)
          .then(function(resp) {
            console.log("## Successfully validated request in App Integration Management Framework.");
            auditData.REQUESTID = (resp && resp.data && resp.data.REQUESTID) ? resp.data.REQUESTID : null;
            req.auditData = auditData;
            next();
          })
          .catch(function(error) {
            if (error.response && error.response.status && error.response.status > 500) {
              // If App Integration Management Framework is not reachable then skipping validation but executing HANA model and sending email.
              console.log("## App Integration Management Framework is Not Reachable, Skipping Validation.");
              console.log("## Status code : " + error.response.status);
              console.log("## Error.response.headers : " + error.response.headers);
              // Sending failure email if framework server is down/not responding.
              sendFailureEmail(auditData);
              next();
            } else if (error.response && error.response.data) {
              // If App Integration Management Framework reachable then not executing HANA model, Sending error back to mendix.
              console.log(error.response.data);
              return res.status(500).send(error.response.data);
            } else {
              // Something happened in setting up the request that triggered an Error
              console.log("## Error to calling framework : " + error.message);
              sendFailureEmail(auditData);
              next();
            }
          });
      }
    } catch (throwedError) {
      res.status(500).send({
        "Status": false,
        "Error": throwedError
      });
    }
  },
  saveAuditDetails: async (req, res, RECORDCOUNT) => {
    console.log("## Calling saveAuditDetails.");
    try {
      let auditData = {};
      if (req && req.auditData) {
        auditData = req.auditData;
      }

      if (auditData && auditData.APP_ENABLE_FLAG) {
        if (auditData && auditData.REQUESTID) {
          auditData.RECORDCOUNT = RECORDCOUNT ? RECORDCOUNT : null;
          auditData.HANASTATUS = (res.statusCode == "200" || res.statusCode == 200) ? "SUCCESS" : "FAILED";
          auditData.ERRORDETAILS = res.statusMessage ? res.statusMessage : "";

          console.log("## Calling Framework : " + AUDIT_ROUTE + " ###");
          axios.post(AUDIT_ROUTE, {
              "auditData": auditData
            }, config)
            .then(function(resp) {
              console.log(`## Successfully saved audit details for request ID : "${auditData.REQUESTID}"`);
              if (resp && resp.data) {
                console.log(resp.data);
              }
            })
            .catch(function(error) {
              console.log(`## Error to saving audit details for request ID : "${auditData.REQUESTID}"`);
              console.log(error);
            });
        } else {
          console.log("## Request ID not found, Skipping audit log store data.");
        }
      } else {
        console.log("## Application enable flag is not enabled, Skipping audit log store data.");
      }
    } catch (throwingError) {
      console.log('## Inside catch of saveAuditDetails.');
      console.log(throwingError);
    }
  }
};

function getAuditData(req) {
  console.log("## Calling getAuditData.");
  return new Promise((resolve, reject) => {
    let temp = {};
    temp.APPNAME = "";
    temp.FUNCTIONNAME = "";
    temp.IPADDRESS = "";
    temp.PARAMETER = "";
    temp.HOSTDNS = "";
    temp.ENVIRONMENT = "";

    temp.APPNAME = "app_mendix_psam"; // VCAP_APPLICATION.application_name.split("-")[0].toUpperCase();
    temp.FUNCTIONNAME = (url.parse(req.url).pathname).split("/").pop() || ("/");
    temp.IPADDRESS = (req.header("x-forwarded-for")) ? req.header("x-forwarded-for") : req.connection.remoteAddress;
    temp.PARAMETER = req.body ? req.body : {};
    dns.reverse(req.connection.remoteAddress, function(err, domains) {
      temp.HOSTDNS = (domains && domains[0]) ? domains[0] : req.headers.host;
    });
    temp.ENVIRONMENT = VCAP_SERVICES.hana[0].credentials.tenant_name;

    if (!temp.APPNAME) {
      reject("Not able to get the APPNAME from VCAP_APPLICATION object.");
    } else if (!temp.FUNCTIONNAME) {
      reject("Not able to get the FUNCTIONNAME from req object.");
    } else if (!temp.IPADDRESS) {
      reject("Not able to get the IPADDRESS from req object.");
    } else if (!temp.ENVIRONMENT) {
      reject("Not able to get the ENVIRONMENT from VCAP_SERVICES object.");
    } else {
      resolve(temp);
    }
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

    hdbext.createConnection(SERVICES.hanaConfig, (connectionError, client) => {
      if (connectionError) {
        client.close();
        console.log("## Connection error in checkApplicationEnableFlag function.");
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
            console.log(queryError);
            reject(`While Getting Application Enable Flag For APPNAME : "${auditData.APPNAME}"`);
          }
        });
      }
    });
  });
}

function sendFailureEmail(auditData) {
  console.log("## Calling sendFailureEmail.");
  try {
    const transporter = nodemailer.createTransport(SMTP_EMAIL_UPS);
    const mailOptions = {
      "from": APP_XSA_JOBS.mailForm,
      "to": APP_XSA_JOBS.failureMailTo,
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
    });
  } catch (throwingError) {
    console.log("## Error to sending email.");
    console.log(throwingError);
  }
}