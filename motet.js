const klaw = require('klaw');
const through2 = require('through2');
const path = require('path');
var mm = require('music-metadata');
const util = require('util');

const hasha = require('hasha');

const lodashId = require('lodash-id');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
 
const adapter = new FileSync('db.json');
const db = low(adapter);

db._.mixin(lodashId);

db.defaults({ music: [] })
  .write()

const excludeDirFilter = through2.obj(function (item, enc, next) {
    if (!item.stats.isDirectory() && (path.extname(item.path) === '.mp3')) this.push(item);
    next();
  });

const items = []; // files, directories, symlinks, etc
var added = 0;
klaw('C:\\Users\\ejevi\\Music')
  .pipe(excludeDirFilter)
  .on('data', item => {
      console.log("Get meta from: " + item.path);
      mm.parseFile(item.path)
        .then(meta => {
            console.log("Meta OK");
            console.log("Save to db");
            var m = meta.common.artist ? meta.common.artist : meta.common.artists[0]; 
            m += meta.common.title +
                meta.common.track.no +
                meta.common.album +
                meta.format.dataformat +
                meta.format.bitrate + 
                meta.format.sampleRate +
                meta.format.numberOfChannels +
                meta.format.duration;
            console.log(m);
            var md5 = hasha(m, {algorithm: 'md5'});
            
            const post = db
                .get('music')
                .find({ md5: md5 })
                .value();
            
            console.log(post);
            if(!post) {
                db.get('music')
                    .push({
                        "md5": md5,  
                        "path": item.path, 
                        "artist": meta.common.artist ? meta.common.artist : meta.common.artists[0],
                        "title": meta.common.title,
                        "track": meta.common.track.no,
                        "album": meta.common.album,
                        "dataformat": meta.format.dataformat,
                        "bitrate": meta.format.bitrate,
                        "sampleRate": meta.format.sampleRate,
                        "numberOfChannels": meta.format.numberOfChannels,
                        "duration": meta.format.duration
                    })
                    .write();
                added++;
                console.log("Saved to db");
            } else {
                console.log("Already in db");
            }
        })
        .catch(error => console.log(error))
      items.push(item.path);
    })
  .on('end', () => console.log("Added to db: " + added));

  console.log("Added to db: " + added);