// The third-party files the page loads, by the FLAT name index.html's import map
// uses, and where each lives in node_modules. Shared by serve.js (development)
// and build.js (the CrazyGames bundle) so the two can never disagree.
'use strict';
const path = require('path');
const NM = path.resolve(__dirname, '..', 'node_modules');
module.exports = {
    'three.module.js': path.join(NM, 'three/build/three.module.js'),
    'three.core.js': path.join(NM, 'three/build/three.core.js'),          // imported by three.module.js
    'RoomEnvironment.js': path.join(NM, 'three/examples/jsm/environments/RoomEnvironment.js'),
    'cannon-es.js': path.join(NM, 'cannon-es/dist/cannon-es.js'),
};
