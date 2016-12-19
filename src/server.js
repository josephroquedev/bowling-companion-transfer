/**
 *
 * @license
 * Copyright (C) 2016 Joseph Roque
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Joseph Roque
 * @created 2016-12-18
 * @file server.js
 * @description Initial script starting point for server.
 *
 */

// Imports
const express = require('express');
const http = require('http');
const path = require('path');

// Print out startup time to default logs
console.log('--------------------');
console.log('Starting new instance of server.');
console.log(new Date());
console.log('--------------------');

// Print out startup time to error
console.error('--------------------');
console.error('Starting new instance of server.');
console.error(new Date());
console.error('--------------------');

// App setup
const app = express();
const port = 8080;
app.set('port', port);

// Create HTTP server
const server = http.createServer(app);
server.on('listening', () => {
  const addr = server.address();
  const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr.port}`;
  console.log(`Listening on ${bind}`);
});
server.on('error', (error) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
});
server.listen(port);

// Setup routes
app.use(express.static(path.join(__dirname, 'assets')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
require('./router')(app);

// Serve favicon
app.use(require('serve-favicon')(path.join(__dirname, 'assets', 'favicon.ico')));





// Modules
let archiver = require('archiver');
let dateFormat = require('dateformat');
let formidable = require('formidable');
let http = require('http');
let fs = require('fs-extra');
let cron = require('cron');
let mongodb = require('mongodb');
let secret = require('./secret');



// Amount of time that a transfer will live on the server before being removed.
const TRANSFER_TIME_TO_LIVE = 1000 * 60 * 60;
// Directory to store user data.
const USER_DATA_LOCATION = __dirname + '/user_backups/';
// Directory to backup zipped copies of user data.
const USER_BACKUP_LOCATION = __dirname + '/user_backups_zipped/'
// Maximum number of keys and bowler data that can be stored on the server at any time.
const MAX_KEYS = 40;

let indexHtml = null;
try {
  indexHtml = fs.readFileSync(__dirname + '/index.html');
} catch (err) {
  indexHtml = '<h1>Error loading page.</h1>';
  console.error(err);
}

// MongoDB
let MongoClient = mongodb.MongoClient;
// Local URL of the mongo database.
const MONGO_URL = 'mongodb://localhost:27017/bowlingdata';
// Name of the collection that data will be stored in.
const MONGO_COLLECTION = 'transfers';
// Regular expression for getting the transfer key from a URL.
const REGEX_KEY = /\?key=([A-Z0-9]{5})$/;

// Generate an ID to represent the file uploaded.
const POSSIBLE_ID_VALUES = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789';
let generateId = function() {
  let text = '';

  for (var i = 0; i < 5; i++)
    text += POSSIBLE_ID_VALUES.charAt(Math.floor(Math.random() * POSSIBLE_ID_VALUES.length));

  return text;
};

// Print a message to the error console with the current time
let logError = function(message) {
  console.error(dateFormat('yyyy/mm/dd HH:MM:ss') + ': ' + message);
}

// Dictionary of keys which have already been used as IDs for transfers.
let usedKeys = {};

// Job to remove files which have been around longer than 1 hour.
// Runs once per hour.
let cleanupCronJob = new cron.CronJob({
  cronTime: '0 0 * * * *',
  onTick: function() {
    console.log('Running cleanupCronJob on ' + (new Date()));

    MongoClient.connect(MONGO_URL, function(err, db) {
      if (err) {
        logError('Error establishing database connection.');
        logError(err);
        return;
      }

      console.log('CronJob established database connection.');

      let currentTime = Date.now();

      // Get a cursor to iterate over the collection.
      let collection = db.collection(MONGO_COLLECTION);
      let cursor = collection.find();

      cursor.each(function(err, doc) {
        if (err) {
          logError('Error retrieving documents.');
          logError(err);
        } else if (doc !== null) {
          if (doc.time + TRANSFER_TIME_TO_LIVE < currentTime) {
            // This file has expired so remove it.
            fs.remove(doc.location, function(err) {
              if (err) {
                logError(`Error removing file ${doc.location}`);
                logError(err);
              } else {
                console.log(`Succesfully deleted file ${doc.location}`);
              }
            });
          } else if (!(doc.key in usedKeys)) {
            // Key is still in use, but isn't in used keys for some reason.
            usedKeys[doc.key] = true;
            console.log('Loaded key from database: ' + doc.key);
          }
        }
      });
    });
  },
  start: false,
  timeZone: 'America/Los_Angeles'
});
cleanupCronJob._callbacks[0]();
cleanupCronJob.start();

let server = http.createServer(function(req, res) {

  console.log('New request on ' + (new Date()));
  console.log('Request URL: ' + req.url);
  console.log('Request method: ' + req.method);

  if (req.url.startsWith('/valid') && req.method.toLowerCase() === 'get') {
    // Route for validating key
    let transfer_key = req.url.match(REGEX_KEY);
    let response = 'INVALID_KEY';
    console.log('Validating key:' + JSON.stringify(transfer_key));
    if (transfer_key !== null && transfer_key.length == 2) {
      transfer_key = transfer_key[1];
      if (transfer_key in usedKeys) {
        response = 'VALID';
      }
    }

    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.write(response);
    res.end();
  } else if (req.url.startsWith('/download') && req.method.toLowerCase() === 'get') {
    // Route for getting bowler data
    let transfer_key = req.url.match(REGEX_KEY);
    let response = 'INVALID_KEY';
    console.log('Validating key:' + JSON.stringify(transfer_key));
    if (transfer_key.length == 2) {
      transfer_key = transfer_key[1];
      if (transfer_key in usedKeys) {
        response = 'VALID';
      }
    }

    if (response === 'INVALID_KEY') {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.write(response);
      res.end();
      return;
    }

    MongoClient.connect(MONGO_URL, function(err, db) {
      if (err) {
        logError('Error establishing database connection.');
        logError(err);
        return;
      }

      console.log('Download established database connection.');

      let collection = db.collection(MONGO_COLLECTION);
      collection.findOne({'key': transfer_key}, function(err, item) {
        if (err) {
          logError('Could not retrieve item with key: ' + transfer_key);
          logError(err);
          return;
        }

        let stat = fs.statSync(USER_DATA_LOCATION + transfer_key);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size
        });

        let stream = fs.createReadStream(USER_DATA_LOCATION + transfer_key, { bufferSize: 32 * 1024 });
        stream.pipe(res);
      });
    });
  } else if (req.url === '/upload' && req.method.toLowerCase() === 'post') {
    // Route for uploading file
    console.log('Receiving upload request.');
    if (req.headers.authorization !== secret.transfer_api_key) {
      console.log('Invalid API key:' + req.headers.authorization);
      res.writeHead(401, {'Content-Type': 'text/plain'});
      res.write('Invalid API key.');
      res.end();
      return;
    }

    // Generate a unique ID for this request.
    let requestId = null;
    do {
      requestId = generateId();
    } while (requestId in usedKeys);
    usedKeys[requestId] = true;
    console.log(`Request ID: ${requestId}`);

    console.log('Initializing form.');
    let form = new formidable.IncomingForm();

    form.on('error', function(err) {
      logError('Error receiving file.');
      logError(err);
    })

    form.parse(req, function(err, fields, files) {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.write(`requestId:${requestId}`);
      res.end();
    });

    form.on('end', function(fields, files) {
      /* Temporary location of our uploaded file */
      var temporaryPath = this.openedFiles[0].path;
      /* The file name of the uploaded file */
      var fileName = requestId;

      console.log(`Transfer complete. File location: ${temporaryPath}`);

      // Copy the file to the new location.
      fs.copy(temporaryPath, USER_DATA_LOCATION + fileName, function(err) {
        if (err) {
          logError('Error copying file.');
          logError(err);
        } else {
          let fullName = USER_DATA_LOCATION + fileName;
          console.log(`File copied successfully. File location: ${fullName}`);
          let outputStream = fs.createWriteStream(USER_BACKUP_LOCATION + fileName + '.zip');
          let zip = archiver('zip');

          outputStream.on('close', function () {
            console.log('Zipped file: ' + zip.pointer());
          });

          zip.on('error', function(err) {
            logError('Error zipping data.')
            logError(err);
          });

          zip.pipe(outputStream);
          zip.file(USER_DATA_LOCATION + fileName, { 'name': fileName }).finalize();
        }

        // Delete the old temp file
        fs.remove(temporaryPath, function(err) {
          if (err) {
            logError('Error removing temp file.');
            logError(err);
          } else {
            console.log('Succesfully deleted temp file.');
          }
        });

        // Store the location of the data in the database.
        MongoClient.connect(MONGO_URL, function(err, db) {
          if (err) {
            logError('Error establishing database connection.');
            logError(err);
            return;
          }

          console.log('Upload established database connection.');

          let collection = db.collection(MONGO_COLLECTION);
          collection.insert({
            key: requestId,
            time: Date.now(),
            location: USER_DATA_LOCATION + fileName
          }, function(err, records) {
            if (err) {
              logError('Failed to insert record.');
              logError(err);
            }

            db.close();
          });
        });
      });
    });
  } else if (req.url === '/status' && req.method.toLowerCase() === 'get') {
    // Route for checking status of the server
    let response = 'OK';
    if (Object.keys(usedKeys).length > MAX_KEYS) {
      // If there is too much data stored right now, return "FULL" to let user know they can't transfer right now.
      response = 'FULL';
    }

    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.write(response);
    res.end();
  } else if (req.url === '/' && req.method.toLowerCase() === 'get') {
    // Display API description page.
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.write(indexHtml);
    res.end();
  }
});

server.listen(PORT);
console.log(`Listening on port ${PORT}`);
