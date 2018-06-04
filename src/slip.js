'use strict';

/**
 * Dependencies
 */
const SerialPort = require("serialport");
const util = require('util');
const SLIPMessage = require('./slip-message.js');
const fs = require('fs');
const defaultProtocolDefinition = JSON.parse(fs.readFileSync(__dirname + '/default-protocol-definition.json', {
  encoding: 'utf8'
}));
const _ = require('underscore');

/**
 * @param {String} path           path to serial port
 * @param {Object} options        options object
 * @param {Object} protocol       protocol definition object
 * @constructor
 */
var SLIP = function (path, options, protocol) {
  //super constructor call
  SerialPort.call(this, path, options)
  protocol = _.defaults(protocol ? protocol : {}, defaultProtocolDefinition)
  SLIPMessage.applyProtocol(protocol)
  this.protocol_ = protocol
  this.endByte_ = new Buffer([protocol.endByte])
  this.messageMaxLength_ = protocol.messageMaxLength;
  // register on data handler
  this.on('data', (data) => {
    this.collectDataAndFireMessageEvent_(data)
  });
}

util.inherits(SLIP, SerialPort)

/**
 * Sends message to device
 * @param  {String}   data     Data array that need to be sent
 * @param  {Function} callback This will fire after sending
 */
SLIP.prototype.sendMessage = function (buffer, callback) {
  var that = this;
  var message = Buffer.concat([new SLIPMessage(buffer), that.endByte_]);
  this.write(message, callback);
}

/**
 * Sends message to device, waiting for all data to be transmitted to the
 * serial port before calling the callback.
 * @param  {String}   data     Data array that need to be sent
 * @param  {Function} callback This will fire after sending
 */
SLIP.prototype.sendMessageAndDrain = function (buffer, callback) {
  var that = this;
  var message = Buffer.concat([new SLIPMessage(buffer), that.endByte_]);
  this.write(message, function (err) {
    if (err) return callback(err);
    this.drain(callback);
  });
}

/**
 * Stores recieved bytes to a temporary array till endByte
 * appears in the chunk then fires 'message' event
 * @private
 * @param  {Buffer}   data
 */
SLIP.prototype.collectDataAndFireMessageEvent_ = (function () {
  let temporaryBuffer = Buffer.alloc(defaultProtocolDefinition.messageMaxLength);
  let writeCursor = 0;
  let emptyBuffer = Buffer.alloc(defaultProtocolDefinition.messageMaxLength);

  emptyBuffer.fill(0);

  return function (data) {
    var endIndex = data.indexOf(this.endByte_);
    if (endIndex === -1) {
      //chunk has no endByte, pushing it to temporary buffer
      writeCursor += data.copy(temporaryBuffer, writeCursor);
    } else {
      if (endIndex > 0) {
        //chunk has data before endByte
        writeCursor += data.copy(temporaryBuffer, writeCursor);
      }

      // If multiple messages, find first one
      let firstMessageEnd;
      while ((firstMessageEnd = temporaryBuffer.indexOf(this.endByte_)) > 0) {

        //copy data from temporary buffer to a new buffer and fire 'message'
        var messageBuffer = Buffer.alloc(firstMessageEnd);

        temporaryBuffer.copy(messageBuffer, 0, 0, firstMessageEnd);

        this.emit('message', SLIPMessage.unescape(messageBuffer));

        // buffer end reached... clear 
        if (firstMessageEnd + 1 === writeCursor) {
          temporaryBuffer.fill(0, 0, writeCursor);
          writeCursor = 0;
          firstMessageEnd = -1;
        } else { // check if further messages to read
          temporaryBuffer.copy(temporaryBuffer, 0, firstMessageEnd + 1, writeCursor); 
          let oldWriteCursor = writeCursor;
          writeCursor -= firstMessageEnd + 1;
          temporaryBuffer.fill(0, writeCursor, oldWriteCursor);
          endIndex = temporaryBuffer.indexOf(this.endByte_);
        }
      }
    }
  }
})()

module.exports = SLIP