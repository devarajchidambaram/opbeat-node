'use strict'

var path = require('path')
var test = require('tape')

var opbeat = require('../../').start({
  organizationId: 'test',
  appName: 'test',
  secretToken: 'test',
  captureExceptions: false,
  logLevel: 'fatal'
})

test('source map inlined', function (t) {
  onError(t, assertSourceFound)
  opbeat.captureError(require('./fixtures/lib/error-inline')())
})

test('source map linked', function (t) {
  t.test('source mapped source code embedded', function (t) {
    onError(t, assertSourceFound)
    opbeat.captureError(require('./fixtures/lib/error-src-embedded')())
  })

  t.test('source mapped source code on disk', function (t) {
    onError(t, assertSourceFound)
    opbeat.captureError(require('./fixtures/lib/error')())
  })

  t.test('source mapped source code not found', function (t) {
    onError(t, assertSourceNotFound)
    opbeat.captureError(require('./fixtures/lib/error-src-missing')())
  })
})

test('fails', function (t) {
  t.test('inlined source map broken', function (t) {
    onError(t, function (t, data) {
      t.equal(data.message, 'Error: foo')
      t.deepEqual(data.exception, {type: 'Error', value: 'foo'})
      t.equal(data.culprit, 'generateError (test/sourcemaps/fixtures/lib/error-inline-broken.js)')

      var frame = data.stacktrace.frames.reverse()[0]
      t.equal(frame.filename, 'test/sourcemaps/fixtures/lib/error-inline-broken.js')
      t.equal(frame.lineno, 6)
      t.equal(frame.function, 'generateError')
      t.equal(frame.in_app, __dirname.indexOf('node_modules') === -1)
      t.equal(frame.abs_path, path.join(__dirname, 'fixtures', 'lib', 'error-inline-broken.js'))
      t.equal(frame.context_line, '  return new Error(msg);')
    })
    opbeat.captureError(require('./fixtures/lib/error-inline-broken')())
  })

  t.test('linked source map not found', function (t) {
    onError(t, function (t, data) {
      t.equal(data.message, 'Error: foo')
      t.deepEqual(data.exception, {type: 'Error', value: 'foo'})
      t.equal(data.culprit, 'generateError (test/sourcemaps/fixtures/lib/error-map-missing.js)')

      var frame = data.stacktrace.frames.reverse()[0]
      t.equal(frame.filename, 'test/sourcemaps/fixtures/lib/error-map-missing.js')
      t.equal(frame.lineno, 6)
      t.equal(frame.function, 'generateError')
      t.equal(frame.in_app, __dirname.indexOf('node_modules') === -1)
      t.equal(frame.abs_path, path.join(__dirname, 'fixtures', 'lib', 'error-map-missing.js'))
      t.equal(frame.context_line, '  return new Error(msg);')
    })
    opbeat.captureError(require('./fixtures/lib/error-map-missing')())
  })

  t.test('linked source map broken', function (t) {
    onError(t, function (t, data) {
      t.equal(data.message, 'Error: foo')
      t.deepEqual(data.exception, {type: 'Error', value: 'foo'})
      t.equal(data.culprit, 'generateError (test/sourcemaps/fixtures/lib/error-broken.js)')

      var frame = data.stacktrace.frames.reverse()[0]
      t.equal(frame.filename, 'test/sourcemaps/fixtures/lib/error-broken.js')
      t.equal(frame.lineno, 6)
      t.equal(frame.function, 'generateError')
      t.equal(frame.in_app, __dirname.indexOf('node_modules') === -1)
      t.equal(frame.abs_path, path.join(__dirname, 'fixtures', 'lib', 'error-broken.js'))
      t.equal(frame.context_line, '  return new Error(msg);')
    })
    opbeat.captureError(require('./fixtures/lib/error-broken')())
  })
})

function onError (t, assert) {
  opbeat._httpClient = {request: function (endpoint, headers, data, cb) {
    assert(t, data)
    t.end()
  }}
}

function assertSourceFound (t, data) {
  t.equal(data.message, 'Error: foo')
  t.deepEqual(data.exception, {type: 'Error', value: 'foo'})
  t.equal(data.culprit, 'generateError (test/sourcemaps/fixtures/src/error.js)')

  var frame = data.stacktrace.frames.reverse()[0]
  t.equal(frame.filename, 'test/sourcemaps/fixtures/src/error.js')
  t.equal(frame.lineno, 2)
  t.equal(frame.function, 'generateError')
  t.equal(frame.in_app, __dirname.indexOf('node_modules') === -1)
  t.equal(frame.abs_path, path.join(__dirname, 'fixtures', 'src', 'error.js'))
  t.deepEqual(frame.pre_context, ['// Just a little prefixing line'])
  t.equal(frame.context_line, 'const generateError = (msg = \'foo\') => new Error(msg)')
  t.deepEqual(frame.post_context, ['', 'module.exports = generateError', ''])
}

function assertSourceNotFound (t, data) {
  t.equal(data.message, 'Error: foo')
  t.deepEqual(data.exception, {type: 'Error', value: 'foo'})
  t.equal(data.culprit, 'generateError (test/sourcemaps/fixtures/src/not/found.js)')

  var frame = data.stacktrace.frames.reverse()[0]
  t.equal(frame.filename, 'test/sourcemaps/fixtures/src/not/found.js')
  t.equal(frame.lineno, 2)
  t.equal(frame.function, 'generateError')
  t.equal(frame.in_app, __dirname.indexOf('node_modules') === -1)
  t.equal(frame.abs_path, path.join(__dirname, 'fixtures', 'src', 'not', 'found.js'))
  t.equal(frame.pre_context, undefined)
  t.equal(frame.context_line, undefined)
  t.equal(frame.post_context, undefined)
}
