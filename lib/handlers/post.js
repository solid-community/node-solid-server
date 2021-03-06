module.exports = handler

const Busboy = require('busboy')
const debug = require('debug')('solid:post')
const path = require('path')
const header = require('../header')
const patch = require('./patch')
const error = require('../http-error')
const { extensions } = require('mime-types')

function handler (req, res, next) {
  const ldp = req.app.locals.ldp
  const contentType = req.get('content-type')
  debug('content-type is ', contentType)
  // Handle SPARQL(-update?) query
  if (contentType === 'application/sparql' ||
      contentType === 'application/sparql-update') {
    debug('switching to sparql query')
    return patch(req, res, next)
  }

  // Handle container path
  let containerPath = req.path
  if (containerPath[containerPath.length - 1] !== '/') {
    containerPath += '/'
  }

  // Check if container exists
  ldp.exists(req.hostname, containerPath, function (err, ret) {
    if (err) {
      return next(error(err, 'Container not valid'))
    }

    let stats
    if (ret) {
      stats = ret.stream
    }

    // Check if container is a directory
    if (stats && !stats.isDirectory()) {
      debug('Path is not a container, 405!')
      return next(error(405, 'Requested resource is not a container'))
    }

    // Dispatch to the right handler
    if (req.is('multipart/form-data')) {
      multi()
    } else {
      one()
    }
  })

  function multi () {
    debug('receving multiple files')

    const busboy = new Busboy({ headers: req.headers })
    busboy.on('file', function (fieldname, file, filename, encoding, mimetype) {
      debug('One file received via multipart: ' + filename)
      ldp.put(
        req.hostname,
        path.join(containerPath, filename),
        file,
        function (err) {
          if (err) {
            busboy.emit('error', err)
          }
        })
    })
    busboy.on('error', function (err) {
      debug('Error receiving the file: ' + err.message)
      next(error(500, 'Error receiving the file'))
    })

    // Handled by backpressure of streams!
    busboy.on('finish', function () {
      debug('Done storing files')
      res.sendStatus(200)
      next()
    })
    req.pipe(busboy)
  }

  function one () {
    debug('Receving one file')
    const { slug, link, 'content-type': contentType } = req.headers
    const links = header.parseMetadataFromHeader(link)
    const mimeType = contentType ? contentType.replace(/\s*;.*/, '') : ''
    const extension = mimeType in extensions ? `.${extensions[mimeType][0]}` : ''

    ldp.post(req.hostname, containerPath, req,
      { slug, extension, container: links.isBasicContainer },
      function (err, resourcePath) {
        if (err) {
          return next(err)
        }
        debug('File stored in ' + resourcePath)
        header.addLinks(res, links)
        res.set('Location', resourcePath)
        res.sendStatus(201)
        next()
      })
  }
}
