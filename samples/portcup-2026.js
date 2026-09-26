/* Sample event: Port Cup 2026 (Open Slovenian Championship), summary for First 18SE / Seascape 18, from NoR v2 and SI v1 */
window.RA_SAMPLE_EVENT = {
  id: 'sample-portcup26',
  name: 'Port Cup 2026 · Portorož (sample)',
  docNames: 'NoR v2, SI v1',
  diagramUrls: ['samples/portcup-2026-courses.png'],
  docs: [{ name: 'NoR Port Cup 2026 v2.pdf', url: 'samples/NoR-PortCup-2026.pdf' }],
  summary: {
    event: 'Open Slovenian Championship 470 · 420 · Fireball · First 18SE / Seascape 18',
    venue: 'Portorož, JK Pirat', dates: '11–13 Sep 2026', organizer: 'Sailing Club Pirat Portorož / Slovenian Sailing Federation',
    key: { first_warning: '12:00 daily', vhf: 'Ch 74 (F18SE + coaches)', time_limit: '60 min (Mark 1: 15 min)', penalty: 'One-Turn (F18SE)' },
    schedule: [
      { day: 'Sat 12 Sep (F18SE)', items: ['09:30–10:30 registration F18SE (race office)', '12:00 first warning, 3 races'] },
      { day: 'Sun 13 Sep', items: ['12:00 first warning, 3 races', 'No warning signal after 16:00', 'Prize giving after racing'] },
      { day: 'Any day', items: ['Max 4 races per day (one extra race allowed)', 'Orange flag + 1 sound ≥ 5 min before a warning signal'] }
    ],
    courses: [
      { name: 'Numeral pennant 1', sequence: ['Start', '1', '4 (gate)', '1', '4 (gate)', 'Finish'], notes: '' },
      { name: 'Numeral pennant 2', sequence: ['Start', '1', '4 (gate)', '1', '2', '3 (gate)', 'Finish'], notes: '' },
      { name: 'Numeral pennant 3', sequence: ['Start', '1', '2', '3 (gate)', '2', '3 (gate)', 'Finish'], notes: 'Course shown on RC signal vessel no later than the warning. Single gate mark: leave to port.' }
    ],
    marks: [
      { name: '1, 2', description: 'yellow inflatable cylinder' },
      { name: '3p/s, 4p/s (gates)', description: 'white inflatable cylinder with red cap' },
      { name: 'New mark (change of course)', description: 'orange inflatable cylinder' },
      { name: 'Class flag F18SE', description: 'Flag F' }
    ],
    start: 'Between the staff with orange flag on the RC signal vessel (starboard end) and the course side of the red inflatable cylinder (port end). Boats not yet in sequence keep clear of the start area. Not started within 4 min = DNS.',
    finish: 'Between staffs with blue flags on the RC vessel (port end) and a spar buoy (starboard end). Tell the RC at the finish if you intend to protest.',
    time_limits: ['Mark 1: 15 min (else race abandoned)', 'Race time limit: 60 min', 'Target time: 40 min', 'Finishing window: 10 min after the first boat (else DNF)'],
    signals: ['Signals ashore on the flag pole at the venue', 'AP ashore: warning not less than 45 min after AP is lowered', 'Orange start-line flag + 1 sound: racing starts soon (≥ 5 min)'],
    penalties: 'F18SE: One-Turn Penalty replaces Two-Turns (RRS 44.1). Appendix P applies; P2.3 does not apply and P2.2 applies to any penalty after the first.',
    protests: 'Report intention to protest to the RC at the finish line. Protest time limit 60 min after the last boat finishes the last race of the day (or no-more-racing signal). Forms at race office or online notice board.',
    scoring: '6 races scheduled for F18SE; 2 races make a series. 4 or more races: worst score discarded.',
    safety: ['Registration in person at the race office', 'Third-party liability insurance proof at registration'],
    equipment: ['Valid measurement certificate', 'Boat may be inspected on the water: go to the designated area when told'],
    other: ['Official notice board online (racingrulesofsailing.org, event 15905) and WhatsApp group', 'SI changes posted before 09:30; schedule changes before 20:00 the day before', 'Leaders wear yellow / blue / red bibs from day 2'],
    changes: []
  }
};
