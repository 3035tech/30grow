const path = require('node:path');
const config = require('../../tailwind.config.js');
module.exports = { ...config, content: [path.join(__dirname, 'app/**/*.jsx'), path.join(__dirname, '../../app/_components/**/*.{js,jsx}'), path.join(__dirname, '../../app/dashboard/**/*.{js,jsx}'), path.join(__dirname, '../../app/employee/**/*.{js,jsx}'), path.join(__dirname, '../../lib/**/*.{js,jsx}')] };
