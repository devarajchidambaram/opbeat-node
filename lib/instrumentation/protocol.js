'use stirct'

var afterAll = require('after-all-results')
var objectAssign = require('object-assign')
var debug = require('debug')('opbeat')
var stackman = require('../stackman')
var parsers = require('../parsers')

exports.encode = encode

/**
 * Encodes recorded transactions into a format expected by the Opbeat intake
 * API.
 *
 * samples:
 *   An array containing objects of type Transaction. It's expected that each
 *   Transaction have a unique name and type within a 15ms window based on its
 *   duration.
 *
 * cb:
 *   A callback which will be called with the encoded data. If the samples
 *   array was empty, the callback will be called without any data.
 */
function encode (samples, cb) {
  if (samples.length === 0) return process.nextTick(cb)
  var agent = samples[0]._agent

  encodeTransactions(samples, agent.captureTraceStackTraces, function (err, transactions) {
    if (err) return cb(err)
    cb(null, {
      app_name: agent.appName,
      transactions: transactions
    })
  })
}

function encodeTransactions (transactions, captureTraceStackTraces, cb) {
  var next = afterAll(function (err, frames) {
    if (err) return cb(err)
    cb(null, transactions.map(function (trans, index) {
      return {
        id: trans.id,
        name: trans.name,
        type: trans.type,
        duration: trans.duration(),
        timestamp: new Date(trans._timer.start).toISOString(),
        result: String(trans.result),
        context: {
          request: trans.req
            ? parsers.getHTTPContextFromRequest(trans.req, {body: trans._agent._logBody})
            : null,
          system: {
            runtime_version: process.version
          },
          user: objectAssign(
            {},
            trans.req && parsers.getUserContextFromRequest(trans.req),
            trans._user
          ),
          tags: trans._tags || {},
          extra: trans._extra || {}
        },
        traces: encodeTraces(trans.traces, frames[index])
      }
    }))
  })

  if (captureTraceStackTraces) {
    transactions.forEach(function (trans) {
      var next2 = afterAll(next())
      trans.traces.forEach(function (trace) {
        // TODO: This is expensive! Consider if there's a way to caching some of this
        traceFrames(trace, next2())
      })
    })
  }
}

function encodeTraces (traces, frames) {
  return traces.map(function (trace, index) {
    return {
      id: index,
      name: trace.name,
      type: trace.truncated ? trace.type + '.truncated' : trace.type,
      start: trace.offsetTime(),
      duration: trace.duration(),
      parent: null,
      stacktrace: frames ? frames[index] : null,
      context: {
        extra: trace.extra // TODO: Currently sql is located inside extra. Consider moving this
      }
    }
  })
}

function traceFrames (trace, cb) {
  if (trace._stackObj.frames) {
    process.nextTick(function () {
      cb(null, trace._stackObj.frames)
    })
    return
  }

  stackman.callsites(trace._stackObj.err, function (err, callsites) {
    if (!callsites) {
      debug('could not capture stack trace for trace %o', {id: trace.transaction.id, name: trace.name, type: trace.type, err: err && err.message})
      cb()
      return
    }

    if (!process.env.OPBEAT_TEST) callsites = callsites.filter(filterCallsite)

    var next = afterAll(function (_, frames) {
      // As of now, parseCallsite suppresses errors internally, but even if
      // they were passed on, we would want to suppress them here anyway
      trace._stackObj.frames = frames
      cb(null, frames)
    })

    callsites.forEach(function (callsite) {
      parsers.parseCallsite(callsite, next())
    })
  })
}

function filterCallsite (callsite) {
  var filename = callsite.getFileName()
  return filename ? filename.indexOf('/node_modules/opbeat/') === -1 : true
}
