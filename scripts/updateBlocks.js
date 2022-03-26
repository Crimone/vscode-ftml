function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
const kebabize = (str) => str.replace(/[A-Z]+(?![a-z])|[A-Z]/g, ($, ofs) => (ofs ? "-" : "") + $.toLowerCase());
!(async ()=>{
  const blocktomllink = 'https://raw.githubusercontent.com/scpwiki/wikijump/develop/ftml/conf/blocks.toml';
  const toml = require('toml');
  const yaml = require('js-yaml');
  const fs = require('fs');
  const path = require('path');
  const got = (await import('got')).default;
  let blocks = toml.parse(await got.get(blocktomllink).text());
  let output = {
    blockStandalone: [],
    blockStandaloneMap: [],
    blockStandaloneValue: [],
    blockStandaloneValueMap: [],
    blockBegin: [],
    blockBeginMap: [],
    blockBeginValue: [],
    blockBeginValueMap: [],
    blockEnd: [],
  }
  for (const block in blocks) {
    let score = blocks[block]['accepts-score'];
    let star = blocks[block]['accepts-star'];
    let aliases = blocks[block].aliases || [];
    let body = blocks[block].body == 'none' ? 'Standalone' : 'Begin';
    let head = '';
    switch (blocks[block].head) {
      case 'map':
        head = 'Map';
        break;
      case 'value':
        head = 'Value'
      case 'value+map':
        head = 'ValueMap'
      case 'none':
      default:
        break;
    }
    if (!blocks[block]['exclude-name']) aliases.unshift(block);
    if (score) aliases = aliases.map(n=>`${n}_`).concat(aliases);
    let stars = [];
    if (star) stars = aliases.map(n=>`*${n}`);
    output['block'+body+head].push(...aliases, ...stars);
    if (body=='Begin') output.blockEnd.push(...aliases);
  }
  output.blockStandaloneValueMap.splice(output.blockStandaloneValueMap.indexOf('include-messy'),1);
  for (const key in output) {
    output[key] = output[key].map(escapeRegExp).join('|');
  }

  let regexes = {
    blockStandalone: {},
    blockStandaloneMap: {},
    blockStandaloneValue: {},
    blockStandaloneValueMap: {},
    blockBegin: {},
    blockBeginMap: {},
    blockBeginValue: {},
    blockBeginValueMap: {},
    blockEnd: {},
  }
  for (const key in regexes) {
    regexes[key].regex = `(?i)${key.endsWith('End')?'((\\[\\[)\\/)':'(\\[\\[)'}\\s*(${output[key]})`
    if (key.endsWith('ValueMap')) {
      regexes[key].regex += '\\s+([^\\s\\]]+)(?=\\s|\\]\\])';
    } else if (key.endsWith('Value')) {
      regexes[key].regex += '\\s+([^]+)(?=\\s|\\]\\])\\s*(\\]\\])'
    } else if (key.endsWith('Map')) {
      regexes[key].regex += '(?=\\s|\\]\\])';
    } else {
      regexes[key].regex += '\\s*(\\]\\])';
    }
    regexes[key].position = key.includes('Map') ? 'begin' : 'match';
    regexes[key].disabled = !output[key];
  }
  let tmLangConfigRaw = fs.readFileSync(path.join(process.cwd(), 'syntaxes/ftml.tmLanguage.yaml'), 'utf-8');
  let tmLangConfig = yaml.load(tmLangConfigRaw.replace(/\# \- include/g, "- include"));
  for (const key in regexes) {
    if (!tmLangConfig.repository[kebabize(key)]) {
      tmLangConfig.repository[kebabize(key)] = {};
    }
    tmLangConfig.repository[kebabize(key)][regexes[key].position] = regexes[key].regex;
  }

  let newTmLangConfigRaw = yaml.dump(tmLangConfig);
  for (const key in regexes) {
    if (regexes[key].disabled) {
      newTmLangConfigRaw = newTmLangConfigRaw.replace(`- include: '#${kebabize(key)}'`, `# - include: '#${kebabize(key)}'`)
    }
  }

  fs.writeFileSync(path.join(process.cwd(), 'syntaxes/ftml.tmLanguage.yaml'), newTmLangConfigRaw, 'utf-8');
  process.exit(0);
})();