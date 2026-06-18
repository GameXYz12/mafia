const ROLE_DEFINITIONS = [
  // Mafia
  { name: 'Mafia', faction: 'mafia', team: 'Mafia Team', unique: false, power: 'Elimination', weight: 5, tags: ['kill', 'basic'], summary: 'Primary killer who selects one target each night.' },
  { name: 'Spy', faction: 'mafia', team: 'Mafia Team', unique: false, power: 'Intel', weight: 4, tags: ['investigate'], summary: 'Learns alignment and a secondary clue.' },
  { name: 'Beast Man', faction: 'mafia', team: 'Mafia Team', unique: false, power: 'False Innocence', weight: 3, tags: ['passive'], summary: 'Reads as suspiciously innocent and resists some investigations.' },
  { name: 'Hostess', faction: 'mafia', team: 'Mafia Team', unique: false, power: 'Charm Block', weight: 4, tags: ['block'], summary: 'Charms a target and blocks their ability.' },
  { name: 'Thief', faction: 'mafia', team: 'Mafia Team', unique: false, power: 'Steal', weight: 3, tags: ['steal'], summary: 'Copies or steals a target ability for the next night.' },
  { name: 'Mad Scientist', faction: 'mafia', team: 'Mafia Team', unique: true, power: 'Experiment', weight: 2, tags: ['random'], summary: 'Triggers unpredictable but controllable experiments.' },
  { name: 'Hitman', faction: 'mafia', team: 'Mafia Team', unique: false, power: 'Contract', weight: 3, tags: ['kill'], summary: 'Gets bonus rewards for eliminating priority targets.' },
  { name: 'Swindler', faction: 'mafia', team: 'Mafia Team', unique: false, power: 'Forgery', weight: 3, tags: ['forge'], summary: 'Creates false investigation results and misdirection.' },
  { name: 'Mercenary', faction: 'mafia', team: 'Mafia Team', unique: false, power: 'Combat', weight: 4, tags: ['attack', 'guard'], summary: 'Can attack or protect Mafia allies.' },
  { name: 'Administrator', faction: 'mafia', team: 'Mafia Team', unique: true, power: 'System Control', weight: 2, tags: ['timing', 'vote'], summary: 'Manipulates timing, announcements, or voting flow.' },

  // Citizen
  { name: 'Cop', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Faction Check', weight: 5, tags: ['investigate'], summary: 'Investigates faction alignment.' },
  { name: 'Doctor', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Protection', weight: 5, tags: ['protect'], summary: 'Protects a player from death.' },
  { name: 'Soldier', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Endurance', weight: 4, tags: ['passive'], summary: 'Survives one fatal attack.' },
  { name: 'Politician', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Lynch Resistance', weight: 3, tags: ['vote'], summary: 'Needs extra pressure to be voted out.' },
  { name: 'Psychic', faction: 'citizen', team: 'Citizen Team', unique: true, power: 'Spirit Talk', weight: 2, tags: ['dead-chat'], summary: 'Receives information from dead players.' },
  { name: 'Lover', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Bond', weight: 2, tags: ['link'], summary: 'Linked to another Lover through a shared bond.' },
  { name: 'Reporter', faction: 'citizen', team: 'Citizen Team', unique: true, power: 'Broadcast', weight: 2, tags: ['broadcast'], summary: 'Publishes information to the whole table.' },
  { name: 'Detective', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Exact Role', weight: 4, tags: ['investigate'], summary: 'Learns the exact role name of a target.' },
  { name: 'Ghoul', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Corpse Theft', weight: 2, tags: ['dead'], summary: 'Interacts with dead players and steals leftovers.' },
  { name: 'Martyr', faction: 'citizen', team: 'Citizen Team', unique: true, power: 'Sacrifice', weight: 2, tags: ['counter'], summary: 'Can trade self-sacrifice for revenge.' },
  { name: 'Priest', faction: 'citizen', team: 'Citizen Team', unique: true, power: 'Revival', weight: 2, tags: ['revive'], summary: 'Can revive a dead player once per game.' },
  { name: 'Gangster', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Intimidation', weight: 3, tags: ['vote'], summary: 'Influences votes through intimidation.' },
  { name: 'Magician', faction: 'citizen', team: 'Citizen Team', unique: true, power: 'Illusion', weight: 3, tags: ['swap'], summary: 'Swaps targets, roles, or effects.' },
  { name: 'Hacker', faction: 'citizen', team: 'Citizen Team', unique: true, power: 'Intercept', weight: 3, tags: ['intercept'], summary: 'Intercepts private communications.' },
  { name: 'Judge', faction: 'citizen', team: 'Citizen Team', unique: true, power: 'Verdict', weight: 2, tags: ['vote-control'], summary: 'Can pardon or condemn during lynch events.' },
  { name: 'Prophet', faction: 'citizen', team: 'Citizen Team', unique: true, power: 'Vision', weight: 2, tags: ['future'], summary: 'Receives visions about future events.' },
  { name: 'Nurse', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Cure', weight: 4, tags: ['cleanse'], summary: 'Supports healing roles and removes status effects.' },
  { name: 'Mentalist', faction: 'citizen', team: 'Citizen Team', unique: false, power: 'Comparison', weight: 3, tags: ['compare'], summary: 'Finds hidden relationships between players.' },

  // Cult
  { name: 'Cult Leader', faction: 'cult', team: 'Cult Team', unique: true, power: 'Recruit', weight: 2, tags: ['convert'], summary: 'Converts one non-Cult player each night.' },
  { name: 'Fanatic', faction: 'cult', team: 'Cult Team', unique: false, power: 'Shield', weight: 2, tags: ['protect', 'investigate-block'], summary: 'Protects Cult members and interferes with investigations.' }
];

const ROLE_MAP = new Map(ROLE_DEFINITIONS.map(role => [role.name, role]));

function getRoleCatalog() {
  return ROLE_DEFINITIONS.map(role => ({ ...role }));
}

function factionForRole(roleName) {
  return ROLE_MAP.get(roleName)?.faction || 'neutral';
}

function roleForName(roleName) {
  return ROLE_MAP.get(roleName) || null;
}

function isUniqueRole(roleName) {
  return !!ROLE_MAP.get(roleName)?.unique;
}

function shuffle(list, rng = Math.random) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick(list, count) {
  return list.slice(0, Math.max(0, count));
}

function rolePoolByFaction(faction) {
  return ROLE_DEFINITIONS.filter(role => role.faction === faction);
}

function factionMixForPlayers(playerCount) {
  const table = [
    { max: 2, mafia: 1, citizen: 1, cultNeutral: 0 },
    { max: 3, mafia: 1, citizen: 2, cultNeutral: 0 },
    { max: 4, mafia: 1, citizen: 3, cultNeutral: 0 },
    { max: 5, mafia: 1, citizen: 4, cultNeutral: 0 },
    { max: 6, mafia: 2, citizen: 4, cultNeutral: 0 },
    { max: 7, mafia: 2, citizen: 5, cultNeutral: 0 },
    { max: 8, mafia: 2, citizen: 5, cultNeutral: 1 },
    { max: 9, mafia: 2, citizen: 6, cultNeutral: 1 },
    { max: 10, mafia: 3, citizen: 6, cultNeutral: 1 },
    { max: 11, mafia: 3, citizen: 7, cultNeutral: 1 },
    { max: 12, mafia: 3, citizen: 8, cultNeutral: 1 },
    { max: 13, mafia: 3, citizen: 8, cultNeutral: 2 },
    { max: 14, mafia: 4, citizen: 8, cultNeutral: 2 },
    { max: 15, mafia: 4, citizen: 9, cultNeutral: 2 },
    { max: 16, mafia: 4, citizen: 10, cultNeutral: 2 },
    { max: 17, mafia: 4, citizen: 10, cultNeutral: 3 },
    { max: 18, mafia: 5, citizen: 10, cultNeutral: 3 },
    { max: 19, mafia: 5, citizen: 11, cultNeutral: 3 },
    { max: 20, mafia: 5, citizen: 12, cultNeutral: 3 }
  ];
  const row = table.find(item => playerCount <= item.max) || table[table.length - 1];
  return {
    mafia: row.mafia,
    citizen: row.citizen,
    cultNeutral: row.cultNeutral
  };
}

function pickUniform(pool, count, rng = Math.random) {
  const picks = [];
  const copy = pool.slice();
  while (picks.length < count && copy.length > 0) {
    const index = Math.floor(rng() * copy.length);
    picks.push(copy.splice(index, 1)[0].name);
  }
  while (picks.length < count && pool.length > 0) {
    picks.push(pool[Math.floor(rng() * pool.length)].name);
  }
  return picks;
}

function createBalancedRoleSet(playerCount, settings = {}) {
  const mix = factionMixForPlayers(playerCount);
  const mafiaPool = shuffle(rolePoolByFaction('mafia'));
  const citizenPool = shuffle(rolePoolByFaction('citizen'));
  const cultPool = shuffle(rolePoolByFaction('cult'));

  const roles = [];
  roles.push(...pickUniform(mafiaPool, mix.mafia));
  roles.push(...pickUniform(citizenPool, mix.citizen));
  roles.push(...pickUniform(cultPool, mix.cultNeutral));

  while (roles.length < playerCount) {
    const fallbackPool = shuffle(ROLE_DEFINITIONS);
    const next = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
    if (next) roles.push(next.name);
  }

  return shuffle(roles).slice(0, playerCount);
}

function roleReveals(roleName) {
  const role = roleForName(roleName);
  return role ? { name: role.name, faction: role.faction, power: role.power, summary: role.summary } : null;
}

module.exports = {
  ROLE_DEFINITIONS,
  getRoleCatalog,
  roleForName,
  factionForRole,
  isUniqueRole,
  shuffle,
  factionMixForPlayers,
  createBalancedRoleSet,
  roleReveals
};
