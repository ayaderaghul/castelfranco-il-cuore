// 8x8 pixel-art item sprites and 8x9 chibi people, rendered as crisp SVG.
import { raw } from './util.js';

const S = {
  macchiato: { rows: ['........', '.FFFFF..', '.CCCCCHH', '.CCCCC.H', '.CCCCCHH', '..CCC...', 'PPPPPPP.', '........'], pal: { F: '#F4EBD0', C: '#8B5A2B', H: '#F4EBD0', P: '#A8A3C2' } },
  cornetto: { rows: ['........', '...DD...', '..DLLD..', '.DLDDLD.', 'DLD..DLD', 'DD....DD', '........', '........'], pal: { D: '#C9772E', L: '#F2C14E' } },
  piatto: { rows: ['........', '..G..G..', '..CCCC..', '.CCGCCC.', '.CCCCGC.', 'PPPPPPPP', '.PPPPPP.', '........'], pal: { C: '#C9813A', G: '#F2E27A', P: '#E8E3D0' } },
  miele: { rows: ['...YY...', '...YY...', '..CYCC..', '.CCYCCC.', '.CCCCYC.', 'PPPPPPPP', '.PPPPPP.', '........'], pal: { C: '#A85A26', Y: '#F2C14E', P: '#E8E3D0' } },
  costine: { rows: ['........', '........', 'RRBRRBRR', 'RRBRRBRR', '.RBRRBR.', 'PPPPPPPP', '.PPPPPP.', '........'], pal: { R: '#B8392E', B: '#F4EBD0', P: '#E8E3D0' } },
  pho: { rows: ['........', '..S..S..', '...S.S..', 'WWWWWWWW', '.BBBBBB.', '..BBBB..', '........', '........'], pal: { S: '#C9C4DE', W: '#E8B86A', B: '#E8E3D0' } },
  spritz: { rows: ['...G....', '..O.....', '.OOOOOO.', '.OOOOOO.', '..OOOO..', '...WW...', '...WW...', '..WWWW..'], pal: { O: '#F07A2A', G: '#5FA864', W: '#C9C4DE' } },
  monte: { rows: ['........', '...W....', '..WWG...', '..GGGG.G', '.GGGGGGG', 'GGGGGGGG', '........', '........'], pal: { W: '#F4EBD0', G: '#8A8AA8' } },
  scarpa: { rows: ['........', '........', '..BB....', '..BBB...', '..BBBBB.', '.BBBBBBB', 'SSSSSSSS', '........'], pal: { B: '#C8553D', S: '#F4EBD0' } },
  giornale: { rows: ['........', '.PPPPPP.', '.PXXPLP.', '.PXXPPP.', '.PLLLLP.', '.PPPPPP.', '.PLLLLP.', '........'], pal: { P: '#E8E3D0', X: '#C8553D', L: '#6E6A8E' } },
  chiacchiera: { rows: ['........', '.WWWWWW.', 'WWWWWWWW', 'WWDWDWDW', 'WWWWWWWW', '.WWWWWW.', '..W.....', '.W......'], pal: { W: '#F4EBD0', D: '#14142B' } },
  gnomo: { rows: ['...R....', '..RRR...', '.RRRRR..', '.SSSSS..', '.WWWWW..', '..WWW...', '.BBBBB..', '.B...B..'], pal: { R: '#D7263D', S: '#F1C9A5', W: '#F4EBD0', B: '#2A6F97' } },
  regalo: { rows: ['...R.R..', '....R...', 'GGGRGGGG', 'GGGRGGGG', 'RRRRRRRR', 'GGGRGGGG', 'GGGRGGGG', '........'], pal: { G: '#8FD694', R: '#D7263D' } },
  loto: { rows: ['........', '...PP...', '..PPPP..', 'P.PPPP.P', 'PPPPPPPP', '.PPPPPP.', 'GGGGGGGG', '........'], pal: { P: '#E58FB8', G: '#3E7C4A' } },
  sole: { rows: ['...Y....', '.Y.Y.Y..', '..YYY...', 'YYYOYYY.', '..YYY...', '.Y.Y.Y..', '...Y....', '........'], pal: { Y: '#F2C14E', O: '#F28C6B' } },
  libro: { rows: ['........', '.BBBBBB.', '.BWWWWB.', '.BWLLWB.', '.BWWWWB.', '.BWLLWB.', '.BBBBBB.', '........'], pal: { B: '#7FB3E6', W: '#F4EBD0', L: '#6E6A8E' } },
  pianta: { rows: ['...GG...', '..GGG.G.', '.G.GGGG.', '..GGG...', '...G....', '.TTTTTT.', '..TTTT..', '..TTTT..'], pal: { G: '#8FD694', T: '#C8553D' } },
  pizza: { rows: ['CCCCCCCC', '.YRYYRY.', '.YYYRYY.', '..YRYY..', '..YYRY..', '...YY...', '...Y....', '........'], pal: { C: '#C9772E', Y: '#F2C14E', R: '#D7263D' } },
  tiramisu: { rows: ['........', 'DDDDDDDD', 'WWWWWWWW', 'BBBBBBBB', 'WWWWWWWW', 'BBBBBBBB', 'PPPPPPPP', '........'], pal: { D: '#6B3E26', W: '#F4EBD0', B: '#A8743E', P: '#A8A3C2' } },
  manzo_ananas: { rows: ['........', '...Y....', '..MYMY..', '.MMYMMY.', '.YMMYMM.', 'PPPPPPPP', '.PPPPPP.', '........'], pal: { M: '#7A3B1F', Y: '#F2D13E', P: '#E8E3D0' } },
  maiale_mango: { rows: ['........', '..O.....', '.KOKKO..', '.KKOKKO.', '.OKKOKK.', 'PPPPPPPP', '.PPPPPP.', '........'], pal: { K: '#D98C6A', O: '#F7A21B', P: '#E8E3D0' } },
  involtini: { rows: ['........', 'WWWWWWW.', 'WSWGWSW.', 'WWWWWWW.', '........', 'WWWWWWW.', 'WSWGWSW.', 'WWWWWWW.'], pal: { W: '#E9E4D4', S: '#F28C6B', G: '#5FA864' } },
  rosa: { rows: ['..RRR...', '.RRDRR..', '.RDRRR..', '..RRR...', '...G.L..', '...GL...', '..LG....', '...G....'], pal: { R: '#D7263D', D: '#8E1B2B', G: '#3E7C4A', L: '#5FA864' } },
  palestra: { rows: ['........', '........', 'GG....GG', 'GGHHHHGG', 'GGHHHHGG', 'GG....GG', '........', '........'], pal: { G: '#8A8AA8', H: '#C9C4DE' } },
  fiume: { rows: ['GGGGGGGG', 'GGTGGGTG', 'BBWBBBBB', 'BBBBBWBB', 'BWBBBBBB', 'GGGGGTGG', 'GTGGGGGG', 'GGGGGGGG'], pal: { G: '#3E7C4A', T: '#2E5E38', B: '#2A6F97', W: '#7FB3E6' } },
  fiore: { rows: ['..P.P...', '.PPPPP..', 'PPPYPPP.', '.PPPPP..', '..P.P...', '...G....', '..GGL...', '...G....'], pal: { P: '#F7A8C4', Y: '#F2C14E', G: '#3E7C4A', L: '#5FA864' } },
  dottore: { rows: ['WWWWWWWW', 'WWWRRWWW', 'WWWRRWWW', 'WRRRRRRW', 'WRRRRRRW', 'WWWRRWWW', 'WWWRRWWW', 'WWWWWWWW'], pal: { W: '#F4EBD0', R: '#D7263D' } },
  soldi: { rows: ['..YDYY..', '.YDDDDY.', 'YYDDYYYY', 'YYDDDDYY', 'YYYDYDYY', '.YDDDDY.', '..YDYY..', '........'], pal: { Y: '#F2C14E', D: '#7A5A10' } },
  stella: { rows: ['...Y....', '...Y....', 'YYYYYYY.', '..YYY...', '..YYY...', '.YY.YY..', 'YY...YY.', '........'], pal: { Y: '#F2C14E' } },
};

export const SPRITE_NAMES = {
  macchiato: 'caffè', cornetto: 'cornetto', piatto: 'piatto', miele: 'miele', costine: 'costine', pho: 'phở',
  spritz: 'aperitivo', monte: 'montagna', scarpa: 'camminata', giornale: 'giornale', chiacchiera: 'chiacchiera',
  gnomo: 'gnomo', regalo: 'regalo', loto: 'loto', sole: 'sole', libro: 'libro', pianta: 'pianta', stella: 'stella',
  pizza: 'pizza', tiramisu: 'tiramisù', manzo_ananas: 'manzo all’ananas', maiale_mango: 'maiale al mango', involtini: 'involtini di gamberi',
  rosa: 'rosa · intimità', palestra: 'palestra', fiume: 'fiume · Musone', fiore: 'fiore', dottore: 'dottore', soldi: 'soldi',
};

function svgFrom(rows, pal, px, label) {
  const w = rows[0].length;
  const h = rows.length;
  let rects = '';
  rows.forEach((r, y) => {
    [...r].forEach((ch, x) => {
      if (ch !== '.' && pal[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[ch]}"/>`;
    });
  });
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return `<svg ${a11y} width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects}</svg>`;
}

/** Item sprite as trusted SVG markup (colors come only from this file). */
export function sprite(key, px = 5) {
  const s = S[key] ?? S.stella;
  return raw(svgFrom(s.rows, s.pal, px));
}

const CHIBI = ['..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SESSES.', '..SSSS..', '..CCCC..', '.CCCCCC.', '..C..C..', '..L..L..'];
const HAIRS = ['#1A1A1A', '#5A3A2A', '#7A4A2A', '#C9A15A', '#3A2A1A', '#B8B8B8', '#8A6A4A'];
const SKINS = ['#F6D2B8', '#F0C8A8', '#EBC09A', '#F1C9A5'];

function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

export const CATEGORY_COLOR = { amici: '#7FB3E6', famiglia: '#E58FB8', pro: '#C79BF2' };

export function chibi(seed, shirt, px = 4) {
  const h = hash(seed);
  const pal = { H: HAIRS[h % HAIRS.length], S: SKINS[(h >> 3) % SKINS.length], E: '#14142B', C: shirt, L: '#2B2B45' };
  return raw(svgFrom(CHIBI, pal, px));
}
