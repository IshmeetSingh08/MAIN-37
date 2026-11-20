module.exports = function assess(text) {
  const s = text.toLowerCase().replace(/’/g, "'");
  const cold = /\b(cold|freezing|chilly|not warming|not getting warm|(?:won't|doesn't) get warm)\b/.test(s);
  const fault = /\b(no heating|not heating|won't (?:start|warm|turn on)|doesn't (?:work|warm|turn on)|not working|stopped working|broken|error|fault|can't get warm)\b/.test(s);
  const equipment = /\b(radiators?|boilers?|thermostats?)\b/.test(s);
  const positive = /\b(?:heating|radiator|boiler|thermostat) (?:is )?(?:works fine|working fine|works normally|working normally)\b/.test(s);
  const dial = /\b(?:dials?|thermostats?) (?:(?:is|are) )?(?:turned up|set high|on|up)\b/.test(s);
  if (/\b(radiator|radiators)\b/.test(s) && cold && /\b(one|single|others work)\b/.test(s))
    return { type:'Single radiator not warming', question:'Which room has the cold radiator, and are the others warming normally?' };
  if ((cold && dial) || (!positive && (fault && equipment || /\bno heating\b/.test(s) || cold && equipment))) {
    if (/\b(boiler|thermostat)\b/.test(s) && fault && !/\bno heating\b/.test(s))
      return { type:'Possible heating controls or boiler issue', question:'What did you notice on the controls or display, and are any rooms still warming?' };
    return { type:'Heating not warming the home', question:'Are all rooms affected, or are some still warming normally?' };
  }
  if (/\b(sink|toilet|blocked drain|broken lock|sparking socket)\b/.test(s)) return { unrelated:true };
  return { question:'Is the heating failing to warm the room, or do you notice a draught? Describe what the radiator or controls are doing.' };
};
