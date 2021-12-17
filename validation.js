var hdbext = require("@sap/hdbext");

console.log('Calling validateRequest');
function validateRequest(options, callback) {
  try {
    console.log("Before normalize");
    console.log(JSON.stringify(options));
    //options = normalizeOptions(options);
    console.log("After normalize");
    console.log(JSON.stringify(options));

    if (options && options.services && options.services.hanaConfig) {
      hdbext.createConnection(options.services.hanaConfig, function(connectionError, client) {
        if (connectionError) {
          return callback(connectionError);
        } else {
          console.log("Inside client.");
          console.log(client);
          var statusOfRequest = false;
          var error = "";

          //return callback(null, statusOfRequest);

          if(options.apiName) {
            var procedureName = options.procedureName;
            hdbext.loadProcedure(client, '', procedureName, function(err, sp) {
              console.log("Inside SP.");
              console.log(err);
              console.log(sp);
              if (!err && sp) {             
                sp({
                  "AppName": options.appName,
                  "APIName": options.apiName,
                  "Environment": options.environment,
                  "IPAddress": options.ipAddress,
                  "ThrottleCount": options.throttleCount, 
                  "Enabled": options.enabled,
                  "Host_dns": options.hostDNS
                }, function(err, parameters, result) {
                  console.log("err");
                  console.log(err);
                  console.log("parameters");
                  console.log(parameters);
                  console.log("result");
                  console.log(result);

                  if (parameters && parameters.STATUS && (parameters.STATUS === 'TRUE' || parameters.STATUS === TRUE)) {
                    statusOfRequest = true;
                    return callback(null, statusOfRequest);
                  } else {
                    error = "Unauthorized request.";
                    return callback(error);
                  }
                });
              } else {
                error = `Procedure ${procedureName} not found.`;
                return callback(error);
              }
            });
          } else {
            error = "Please enter the all keys in options object.";
            return callback(error);
          }
        }
      });
    } else {
      var err = "Please enter the services key in options object.";
      return callback(err);
    }
  } catch (throwingError) {
    return callback(throwingError);
  }
}

function normalizeOptions(options) {
  options = JSON.parse(JSON.stringify(options))

  if (options.appName) {
    options.appName = options.appName;
  } else {
    options.appName = "";
  }

  if (options.apiName) {
    options.apiName = options.apiName;
  } else {
    options.apiName = "";
  }

  if (options.environment) {
    options.environment = options.environment;
  } else {
    options.environment = "";
  }

  if (options.IPADDRESS) {
    options.IPADDRESS = options.IPADDRESS;
  } else {
    options.IPADDRESS = "";
  }
  
  if (options.Host_dns) {
    options.Host_dns = options.Host_dns;
  } else {
    options.Host_dns = "";
  }

  return options;
}

module.exports.validateRequest = validateRequest;

