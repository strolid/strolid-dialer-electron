const http = require('http');

const PORT = process.env.PORT || 3020;


exports.startServer = function () {
  const server = http.createServer((req, res) => {
    // Check if the request path is /ping
    if (req.url === '/ping') {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('PONG FROM STROLID DIALER');
    } else {
      res.writeHead(404, {'Content-Type': 'text/plain'});
      res.end('Not Found');
    }
  });

// Start the server and listen on the specified port
  server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
  });
}
