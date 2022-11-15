'use strict';

const axios = require("axios");
const url = require("url");
const xsenv = require("@sap/xsenv");
const https = require("https");
const nodemailer = require("nodemailer");
const hdbext = require("@sap/hdbext");
const dns = require('dns');
const crypto = require('crypto');
const algorithm = "aes-192-cbc";
const secret = "my-secret-key";
const key = crypto.scryptSync(secret, 'salt', 24);
const iv = crypto.randomBytes(16);

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

let config = {
  httpsAgent,
  method: "post",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  }
};

module.exports = {
  validateInboundRequest: async (req, res, next) => {
    try {
      var options = {};
      // options.SERVICES = xsenv.getServices({
      //   hanaConfig: {
      //     tag: "hana"
      //   }
      // });
      options.APP_XSA_JOBS = xsenv.getServices({
        "name": "app_xsa_jobs-jobUserCredentials"
      }).name;
      options.SMTP_EMAIL_UPS = xsenv.getServices({
        "name": "smtp_email_enterprise"
      }).name;
      // options.VCAP_APPLICATION = JSON.parse(process.env.VCAP_APPLICATION);
      // options.VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);

      console.log("options");
      console.log(options);

      return res.status(500).send(options);
    } catch (throwedError) {
      res.status(500).send(throwedError);
    }
  }
};


