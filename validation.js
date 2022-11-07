var hdbext = require("@sap/hdbext");

function validateInboundRequest(req, res, next) {
  console.log('Calling validateInboundRequest');
  try {
    return next(null);
  } catch (throwingError) {
    res.status(500).send(throwingError);
  }
}


module.exports.validateInboundRequest = validateInboundRequest;
