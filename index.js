'use strict'
module.exports = writeFile
module.exports.sync = writeFileSync
module.exports._getTmpname = getTmpname // for testing

var fs = require('graceful-fs')
// var chain = require('slide').chain
var MurmurHash3 = require('imurmurhash')

var invocations = 0
function getTmpname (filename) {
  return filename + '.' +
    MurmurHash3(__filename)
      .hash(String(process.pid))
      .hash(String(++invocations))
      .result()
}

function writeFile (filename, data, options, callback) {
  if (options instanceof Function) {
    callback = options
    options = null
  }
  if (!options) options = {}
  fs.realpath(filename, function (_, realname) {
    _writeFile(realname || filename, data, options, callback)
  })
}
function _writeFile (filename, data, options, callback) {
  var tmpfile = getTmpname(filename)
  new Promise(function stat (resolve, reject) {
    if (options.mode && options.chown) resolve()
    else {
      // Either mode or chown is not explicitly set
      // Default behavior is to copy it from original file
      fs.stat(filename, function (err, stats) {
        if (err || !stats) resolve()
        else {
          options = Object.assign({}, options)
          if (!options.mode) {
            options.mode = stats.mode
          }
          if (!options.chown && process.getuid) {
            options.chown = { uid: stats.uid, gid: stats.gid }
          }
          resolve()
        }
      })
    }
  }).then(function thenWriteFile () {
    return new Promise(function (resolve, reject) {
      writeFileAsync(tmpfile, data, options.mode, options.encoding || 'utf8', function (err) {
        if (err) reject(err)
        else resolve()
      })
    }).then(function chown () {
      if (options.chown) {
        return new Promise(function (resolve, reject) {
          fs.chown(tmpfile, options.chown.uid, options.chown.gid, function (err) {
            if (err) reject(err)
            else resolve()
          })
        })
      }
    }).then(function chmod () {
      if (options.mode) {
        return new Promise(function (resolve, reject) {
          fs.chmod(tmpfile, options.mode, function (err) {
            if (err) reject(err)
            else resolve()
          })
        })
      }
    }).then(function rename () {
      return new Promise(function (resolve, reject) {
        fs.rename(tmpfile, filename, function (err) {
          if (err) reject(err)
          else resolve()
        })
      })
    }).then(function success () {
      callback()
    }).catch(function fail (err) {
      fs.unlink(tmpfile, function () {
        callback(err)
      })
    })
  })

  // doing this instead of `fs.writeFile` in order to get the ability to
  // call `fsync`.
  function writeFileAsync (file, data, mode, encoding, cb) {
    var fd
    new Promise(function (resolve, reject) {
      fs.open(file, 'w', options.mode, function (err, _fd) {
        fd = _fd
        if (err) reject(err)
        else resolve()
      })
    }).then(function () {
      return new Promise(function (resolve, reject) {
        if (Buffer.isBuffer(data)) {
          fs.write(fd, data, 0, data.length, 0, function (err) {
            if (err) reject(err)
            else resolve()
          })
        } else if (data != null) {
          fs.write(fd, String(data), 0, String(encoding), function (err) {
            if (err) reject(err)
            else resolve()
          })
        } else resolve()
      })
    }).then(function syncAndClose () {
      return new Promise(function (resolve, reject) {
        fs.fsync(fd, function (err) {
          if (err) reject(err)
          else fs.close(fd, resolve)
        })
      })
    }).then(cb, cb)
  }
}

function writeFileSync (filename, data, options) {
  if (!options) options = {}
  try {
    filename = fs.realpathSync(filename)
  } catch (ex) {
    // it's ok, it'll happen on a not yet existing file
  }
  var tmpfile = getTmpname(filename)

  try {
    if (!options.mode || !options.chown) {
      // Either mode or chown is not explicitly set
      // Default behavior is to copy it from original file
      try {
        var stats = fs.statSync(filename)
        options = Object.assign({}, options)
        if (!options.mode) {
          options.mode = stats.mode
        }
        if (!options.chown && process.getuid) {
          options.chown = { uid: stats.uid, gid: stats.gid }
        }
      } catch (ex) {
        // ignore stat errors
      }
    }

    var fd = fs.openSync(tmpfile, 'w', options.mode)
    if (Buffer.isBuffer(data)) {
      fs.writeSync(fd, data, 0, data.length, 0)
    } else if (data != null) {
      fs.writeSync(fd, String(data), 0, String(options.encoding || 'utf8'))
    }
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    if (options.chown) fs.chownSync(tmpfile, options.chown.uid, options.chown.gid)
    if (options.mode) fs.chmodSync(tmpfile, options.mode)
    fs.renameSync(tmpfile, filename)
  } catch (err) {
    try { fs.unlinkSync(tmpfile) } catch (e) {}
    throw err
  }
}
