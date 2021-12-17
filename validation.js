var hdbext = require("@sap/hdbext");
var apiProcedureName = "sp_api_management";
var throttleProcedureName = "sp_Throttle_check";

function validateRequest(options, finalCB) {
  console.log('Calling validateRequest');
  try {
    options = normalizeOptions(options);

    if (options && options.services && options.services.hanaConfig) {
      hdbext.createConnection(options.services.hanaConfig, function(connectionError, client) {
        console.log('>>>>>> Inside Client >>>>>>>>>');
        console.log(connectionError);
        console.log(client);

        if (connectionError) {
          return callback(connectionError);
        } else {
          var statusOfRequest = false;
          var errorMsg = "";
          async.parallel([(parallelCB) => {
            hdbext.loadProcedure(client, '', apiProcedureName, function(err, sp) {
              console.log('>>>>>> Inside 1st Parrallel >>>>>>>>>');
              console.log(err);
              console.log(sp);
              if (!err && sp) {
                sp({
                  "APPNAME": options.APPNAME,
                  "APINAME": options.APINAME,
                  "ENVIRONMENT": options.ENVIRONMENT,
                  "IPADDRESS": options.IPADDRESS,
                  "Host_dns": options.Host_dns,
                  "STATUS": ""
                }, function(err, parameters, result) {
                  console.log('>>>>>> Inside 1st Parrallel Result >>>>>>>>>');
                  console.log(">> err >>");
                  console.log(err);
                  console.log(">> parameters >>");
                  console.log(parameters);
                  console.log(">> result >>");
                  console.log(result);
                  if (parameters && parameters.STATUS && parameters.STATUS === 'TRUE') {
                    statusOfRequest = true;
                    parallelCB(null, statusOfRequest);
                  } else if (err) {
                    parallelCB(err);
                  } else {
                    errorMsg = "Invalid IP address or Host name.";
                    parallelCB(errorMsg);
                  }
                });
              } else {
                errorMsg = `Procedure ${apiProcedureName} not found.`;
                parallelCB(errorMsg);
              }
            });
          }, function(parallelCB) {
            hdbext.loadProcedure(client, '', throttleProcedureName, function(err, sp) {
              console.log('>>>>>> Inside 2nd Parrallel >>>>>>>>>');
              console.log(err);
              console.log(sp);
              if (!err && sp) {
                sp({
                  "APPNAME": options.APPNAME,
                  "IPADDRESS": options.IPADDRESS
                }, function(err, parameters, result) {
                  console.log('>>>>>> Inside 2nd Parrallel Result >>>>>>>>>');
                  console.log(">> err >>");
                  console.log(err);
                  console.log(">> parameters >>");
                  console.log(parameters);
                  console.log(">> result >>");
                  console.log(result);
                  if (parameters && parameters.STATUS && parameters.STATUS === 'TRUE') {
                    statusOfRequest = true;
                    parallelCB(null, statusOfRequest);
                  } else if (err) {
                    parallelCB(err);
                  } else {
                    errorMsg = "You have exceeded the 1000 requests in 1 min limit!";
                    parallelCB(errorMsg);
                  }
                });
              } else {
                errorMsg = `Procedure ${throttleProcedureName} not found.`;
                parallelCB(errorMsg);
              }
            });
          }], function done(parallelErr, parallelResults) {
            if (err) {
              finalCB(parallelErr);
            } else {
              finalCB(null, parallelResults);
            }
          });
        }
      });
    } else {
      var err = "Please enter the services key in options object.";
      return finalCB(err);
    }
  } catch (throwingError) {
    return finalCB(throwingError);
  }
}

function normalizeOptions(options) {
  try {
    options = JSON.parse(JSON.stringify(options))

    if (options && options.appName) {
      options.appName = options.appName;
    } else {
      options.appName = "";
    }

    if (options && options.apiName) {
      options.apiName = options.apiName;
    } else {
      options.apiName = "";
    }

    if (options && options.environment) {
      options.environment = options.environment;
    } else {
      options.environment = "";
    }

    if (options && options.IPADDRESS) {
      options.IPADDRESS = options.IPADDRESS;
    } else {
      options.IPADDRESS = "";
    }

    if (options && options.Host_dns) {
      options.Host_dns = options.Host_dns;
    } else {
      options.Host_dns = "";
    }

    return options;
  } catch (throwingError) {
    console.log(">>>>> throwingError >>>>>>");
    console.log(throwingError);
    return options;
  }
}

module.exports.validateRequest = validateRequest;
