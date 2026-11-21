function assess(text) {
  const s = text.toLowerCase().replace(/’/g, "'");
  const cold = /\b(cold|freezing|chilly|not warming|not getting warm|(?:won't|doesn't) get warm)\b/.test(s);
  const fault = /\b(no heating|not heating|won't (?:start|warm|turn on)|doesn't (?:work|warm|turn on)|not working|stopped working|broken|error|fault|can't get warm)\b/.test(s);
  const equipment = /\b(radiators?|boilers?|thermostats?)\b/.test(s);
  const positive = /\b(?:heating|radiator|boiler|thermostat) (?:is )?(?:works fine|working fine|works normally|working normally)\b/.test(s);
  const dial = /\b(?:dials?|thermostats?) (?:(?:is|are) )?(?:turned up|set high|on|up)\b/.test(s);
  const room = /\b(bedroom|kitchen|bathroom|living room|hallway|office|nursery)\b/.test(s);
  const wholeHome = /\b(all (?:the )?(?:rooms|radiators)|every room|whole (?:house|home|apartment)|throughout)\b/.test(s);
  if (/\bradiator\b/.test(s) && cold && (room || /\b(one|single|others work)\b/.test(s)))
    return { type:'Single radiator not warming', complete:room, question:'Which room has the cold radiator, and are the others warming normally?' };
  if ((cold && dial) || (!positive && (fault && equipment || /\bno heating\b/.test(s) || cold && equipment))) {
    if (/\b(boiler|thermostat)\b/.test(s) && fault && !/\bno heating\b/.test(s))
      return { type:'Possible heating controls or boiler issue', complete:wholeHome && /\b(error|display|code)\b/.test(s), question:'What did you notice on the controls or display, and are any rooms still warming?' };
    return { type:'Heating not warming the home', complete:wholeHome && (equipment || dial), question:'Are all rooms affected, or are some still warming normally?' };
  }
  if (/\b(sink|toilet|blocked drain|broken lock|sparking socket)\b/.test(s)) return { unrelated:true };
  return { question:'Is the heating failing to warm the room, or do you notice a draught? Describe what the radiator or controls are doing.' };
}

function reportDetails(text) {
  const room = text.match(/\b(bedroom|kitchen|bathroom|living room|hallway|office|nursery)\s+radiator\b/i)?.[1].toLowerCase();
  // Only interpret times explicitly tied to the resident's availability.
  const times = [...text.matchAll(/\b(?:home|available|can be there)\s+(?:only\s+)?after\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::([0-5]\d))?(?:\s*(a\.?m\.?|p\.?m\.?|in the afternoon|in the evening|in the morning))?\b(?!:)/gi)];
  if (times.length !== 1) return {room};
  const [,rawHour,minute,period] = times[0];
  const words = ['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  let hour = /^\d/.test(rawHour) ? Number(rawHour) : words.indexOf(rawHour.toLowerCase()) + 1;
  if (hour > 23 || (period && (hour < 1 || hour > 12))) return {room};
  if (period) hour = hour % 12 + (/^p|afternoon|evening/i.test(period) ? 12 : 0);
  else if (!minute && hour >= 1 && hour <= 7) hour += 12;
  return {room,availableAfter:String(hour).padStart(2,'0') + ':' + (minute ?? '00')};
}

module.exports = assess;
module.exports.reportDetails = reportDetails;
