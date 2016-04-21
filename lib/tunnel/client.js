'use strict';

var kad = require('kad');
var assert = require('assert');
var WebSocketClient = require('ws');
var TunnelMuxer = require('./multiplexer');
var TunnelDemuxer = require('./demultiplexer');
var events = require('events');
var inherits = require('util').inherits;
var http = require('http');
var https = require('https');
var url = require('url');
var merge = require('merge');

/**
 * Creates a tunnel connection to a {@link TunnelServer}
 * @constructor
 * @param {String} tunnel - URI for remote tunnel
 * @param {String} target - Local address/port for forwarding tunneled messages
 */
function TunnelClient(tunnel, target) {
  if (!(this instanceof TunnelClient)) {
    return new TunnelClient(tunnel, target);
  }

  assert(typeof tunnel === 'string', 'Invalid tunnel address supplied');
  assert(typeof target === 'string', 'Invalid target address supplied');

  this._tunuri = tunnel;
  this._target = target;
  this._tunnel = null;
  this._muxer = null;
  this._demuxer = null;
  this._channels = {};

  events.EventEmitter.call(this);
}

/**
 * Triggered when the tunnel is opened
 * @event TunnelClient#open
 */

/**
 * Triggered when the tunnel is closed
 * @event TunnelClient#close
 */

inherits(TunnelClient, events.EventEmitter);

/**
 * Opens the tunnel connection
 */
TunnelClient.prototype.open = function() {
  var self = this;

  this._demuxer = new TunnelDemuxer();
  this._muxer = new TunnelMuxer();
  this._tunnel = new WebSocketClient(this._tunuri);

  this._demuxer.on('error', function(err) {
    self.emit('error', err);
  });

  this._demuxer.on('data', function(object) {
    switch (object.type) {
      case 'rpc':
        self._handleRPC(object);
        break;
      case 'datachannel':
        self._handleDataChannel(object);
        break;
      default:
        // NOOP
    }
  });

  this._muxer.on('error', function(err) {
    self.emit('error', err);
  });

  this._muxer.on('data', function(buffer) {
    self._tunnel.send(buffer, { binary: true });
  });

  this._tunnel.on('error', function(err) {
    self.close();
    self.emit('error', err);
  });

  this._tunnel.on('close', function() {
    self.close();
  });

  this._tunnel.on('open', function() {
    self.emit('open');
  });

  this._tunnel.on('message', function(data) {
    self._demuxer.write(data);
  });
};

/**
 * Closes the tunnel connection
 */
TunnelClient.prototype.close = function() {
  if (!this._tunnel) {
    return this.emit('error', new Error('Tunnel is not open'));
  }

  var states = [WebSocketClient.CONNECTING, WebSocketClient.OPEN];

  if (states.indexOf(this._tunnel.readyState) !== -1) {
    this._tunnel.close();
  }

  this._tunnel = null;

  this.emit('close');
};

/**
 * Handles incoming RPC messages and forwards them to the target, proxying the
 * response back through to the tunnel server
 * @private
 * @param {Object} object - The demuxed message object
 */
TunnelClient.prototype._handleRPC = function(object) {
  var self = this;
  var target = url.parse(this._target);
  var client = target.protocol === 'https:' ? https : http;
  var options = merge(target, { method: 'POST' });
  var request = client.request(options, this._forwardResponse.bind(this));

  request.on('error', function(err) {
    self.emit('error', err);
  });

  request.write(object.data.serialize());
  request.end();
};

/**
 * Buffers the supplied response stream and sends it through the multiplexer
 * and back to the tunnel server
 * @private
 * @param {http.ServerResponse} res
 */
TunnelClient.prototype._forwardResponse = function(res) {
  var self = this;
  var buffer = Buffer([]);

  res.on('data', function(data) {
    buffer = Buffer.concat([buffer, data]);
  });

  res.on('end', function() {
    self._muxer.write({
      type: 'rpc',
      data: kad.Message.fromBuffer(buffer),
      flags: {}
    });
  });
};

/**
 * Handles incoming datachannel messages and forwards them to the target,
 * proxying the response back through to the tunnel server
 * @private
 * @param {Object} object - The demuxed message object
 */
TunnelClient.prototype._handleDataChannel = function(object) {
  var self = this;
  var urlobj = url.parse(this._target);
  var proto = urlobj.protocol === 'https:' ? 'wss://' : 'ws://';
  var destination = proto + urlobj.hostname + ':' + urlobj.port;
  var quid = object.flags.quid;

  if (this._channels[object.flags.quid]) {
    return this._channels[quid].send(object.data, {
      binary: object.flags.binary
    });
  }

  var socket = this._channels[quid] = new WebSocketClient(destination);

  socket.on('open', function() {
    socket.send(object.data, { binary: object.flags.binary });
  });

  socket.on('error', function(err) {
    self.emit('error', err);
  });

  socket.on('message', function(data, flags) {
    self._muxer.write({
      type: 'datachannel',
      data: data,
      flags: {
        binary: flags.binary,
        quid: quid
      }
    });
  });

  socket.on('close', function() {
    delete self._channels[quid];
  });
};

module.exports = TunnelClient;