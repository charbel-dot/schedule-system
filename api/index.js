/*
 * Vercel serverless entry point.
 * Vercel uses the exported Express app as the function handler — it never calls
 * app.listen(). All requests are routed here by vercel.json.
 */
module.exports = require('../server.js');
