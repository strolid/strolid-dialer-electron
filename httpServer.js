const http = require('http');

const PORT = process.env.PORT || 3020;


exports.startServer = function () {
  const server = http.createServer((req, res) => {
    // Allow requests from any origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
    } else {
      // Check if the request path is /ping
      if (req.url === '/ping') {
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('PONG FROM STROLID DIALER');
      } else {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end('Not Found');
      }
    }
  });

// Start the server and listen on the specified port
  server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
  });

}
