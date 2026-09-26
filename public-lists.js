/* The Race App — public checklists. '# Title' = section header. draft:true = not yet reviewed by a class sailor. */
(function () {
  'use strict';
  var C = {
    // CLOTHING
    dinghy: ['Buoyancy aid (PFD) + whistle', 'Wetsuit / drysuit (for conditions)', 'Rash vest / thermal top', 'Spray top / smock', 'Sailing boots', 'Sailing gloves (+ spare pair)', 'Cap / beanie', 'Warm dry clothes for after', 'Towel'],
    hike: ['Hiking pants'],
    trap: ['Trapeze harness (crew)'],
    fast: ['Helmet', 'Impact vest / buoyancy aid', 'Hook knife on PFD'],
    keel: ['Lifejacket / PFD for every crew member', 'Foul-weather jacket + trousers', 'Deck boots / sailing shoes', 'Sailing gloves', 'Cap / beanie', 'Crew shirts / team kit', 'Warm dry clothes for after', 'Towel'],
    // OTHER / F&B / MEDICAL
    other: ['Sunscreen', 'Sunglasses + strap', 'Hand compass / tactical compass', 'Race timer / Vakaros', 'Phone in waterproof case', 'Phone charger + power bank',
      'NoR / SI (on phone or printed)', 'Measurement certificate / class membership', 'Entry confirmation / ID', 'Water bottle'],
    fnb: ['Water (1.5 L+ per person per day)', 'Electrolyte drink', 'Energy bars', 'Bananas / fruit', 'Lunch for on the water', 'Supplements'],
    medical: ['Plasters / blister kit', 'Painkillers', 'Antiseptic', 'Hand tape', 'Seasickness tablets', 'Personal medication', 'After-sun'],
    // TOOLS
    tools: ['Screwdrivers (Phillips + flat)', 'Allen keys', 'Adjustable spanner', 'Pliers', 'Knife', 'Rigging tape / duct tape',
      'Spare shackles, clevis pins, split rings, ring dings', 'Spare lines / sheets', 'Spare sail ties / shock cord', 'Sponge + bailer'],
    rigTools: ['Rig tension gauge (Loos)', 'Tuning guide / notes', 'Spare shroud pins + split rings'],
    // TRANSPORT
    dTrans: ['Launching trolley', 'Road trailer / roof rack', 'Ratchet straps (+ spares)', 'Top cover', 'Bottom / hull cover', 'Spar bag', 'Foil bags (rudder + board)',
      'Lighting board + plug adapter', 'Number plate / registration', 'Padding / cradles', 'Spare wheel + trailer jack'],
    kTrans: ['Road trailer checked (tyres, bearings, brakes)', 'Mast support / crutch on trailer', 'Ratchet straps (+ spares)', 'Boat cover', 'Keel secured in cradle',
      'Lifting sling / crane strap', 'Mast-up gear (gin pole, tools)', 'Lighting board + plug adapter', 'Number plate / registration', 'Spare wheel + jack', 'Wheel chocks'],
    cTrans: ['Beach trolley / cradles', 'Road trailer', 'Ratchet straps (+ spares)', 'Hull covers', 'Foil / board bags', 'Mast bag', 'Trampoline cover',
      'Lighting board + plug adapter', 'Number plate / registration', 'Spare wheel + jack']
  };
  function cat() { var a = []; for (var i = 0; i < arguments.length; i++) a = a.concat(arguments[i]); return a; }
  var DRAFT = 'Draft: not yet reviewed by a class sailor. Copy it to My lists and adjust.';

  window.RA_PUBLIC_LISTS = [
    { id: 'pub-ilca', name: 'ILCA (Laser)', cls: 'ILCA', draft: true,
      source: 'Boat section based on the ILCA/Laser Equipment Checklist (Regatta Network). ' + DRAFT,
      subs: {
        clothing: cat(C.dinghy.slice(0, 2), C.hike, C.dinghy.slice(2)),
        boat: ['# Lines', 'All lines checked for chafe and fraying', 'Knots and splices checked', 'Mainsheet 7–8 mm',
          'Outhaul, cunningham and vang rigged and tested before leaving', 'Vang: all purchases rigged', 'Cunningham at least 8:1 (10:1 full rig)',
          '# Deck and hull fittings', 'Fitting screws hand-tight (no drill)', 'Cunningham / outhaul turning-block plate secure', 'Cunningham and outhaul deck cleats',
          'Mainsheet block eye-strap screws', 'Hiking strap eye-strap screws', 'Gudgeons and screws: no cracks', 'Grab rails: tight, no cracks',
          'Traveller fairleads: no cracks or wear (metal, not plastic)', 'Bailer opens and closes', 'Transom plug in, O-ring OK',
          '# Spars', 'No corrosion around riveted fittings', 'No scoring at mast base (deck level)', 'Gooseneck rivets tight', 'Vang tang rivets tight, no cracks',
          'Upper collar rivets tight', 'Boom block rivets and blocks OK', 'Traveller blocks OK', 'Upper and lower mast straight (sight down the mast)',
          'Upper / lower fit snug (tape collar if loose)', 'Composite top cap secured', 'Mast retaining line fitted (180° rotation)',
          '# Blades and tiller', 'Daggerboard and rudder: no cracks or missing glass', 'Daggerboard stopper and retaining elastic', 'Rudder lift stop works (rudder cannot pull out)',
          'Rudder retaining clip / ring ding', 'Tiller extension universal: no cracks', 'Extension rubber not splitting',
          '# Vang', 'Vang pin secured (clevis pin + ring ding)', 'Upper vang block not bent', 'Vang key retaining bolt tight',
          '# Sail and hull', 'Sail, battens, sail ties', 'Sail numbers / class markings', 'Hull drained, no leaks found'],
        tools: cat(C.tools, ['Rivet tool (two-handed for stainless)', 'Stainless and aluminium rivets', 'Drill + bits', 'Loctite + lanolin', 'Two-part epoxy + threaded inserts', 'Blade repair kit / sandpaper']),
        transport: C.dTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } },

    { id: 'pub-first18', name: 'First 18 / Seascape 18', cls: 'First 18', draft: true, source: DRAFT,
      subs: {
        clothing: C.keel,
        boat: ['# Hull and keel', 'Keel down and locked', 'Keel lifting system works', 'Rudder(s) and tiller linkage secure', 'Bilge dry, pump works', 'Hatches and drain plugs closed',
          '# Rig', 'Rig tuned for conditions (tuning guide)', 'Shroud pins taped / ring dings', 'Halyards free and not twisted', 'Bowsprit extends and retracts',
          '# Sails', 'Mainsail + battens', 'Jib', 'Asymmetric spinnaker packed', 'Sail numbers', '# Sheets and controls', 'Main and jib sheets', 'Spinnaker sheets + tack line',
          'Vang, cunningham, outhaul', 'Hiking lines / lifelines', '# Safety and equipment', 'Outboard + fuel (if used)', 'Anchor + line', 'Paddle', 'Bucket / bailer',
          'Throw line', 'Horn / whistle', 'Mooring lines + fenders', 'Safety equipment per NoR / class rules'],
        tools: cat(C.tools, C.rigTools), transport: C.kTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } },

    { id: 'pub-opti', name: 'Optimist', cls: 'Optimist', draft: false,
      source: 'Based on a club Optimist coach\'s packing list and tool-box lists (translated from Serbian).',
      subs: {
        clothing: ['# Mandatory', 'Buoyancy aid (PFD) with whistle', 'Cap with lanyard', 'Long-sleeve shirt', 'Spray top', 'Wetsuit', 'Sailing boots', 'Hiking shorts',
          'Trainers', 'Socks', 'Wool socks', 'Tracksuit', 'Wool beanie', 'Longer shorts', '# Extra', 'Sailing gloves', 'Knee pads', 'Shin guards', 'Shorts', 'Underwear (×3)',
          'Wool sweater (×2)', 'Shoes', 'Plastic slippers / flip-flops'],
        boat: ['# Hull and foils', 'Hull', 'Buoyancy compartment covers (×2)', 'Bungs (×2)', 'Screws (×2)', 'Daggerboard with line', 'Daggerboard rubber', 'Daggerboard bag',
          'Rudder with line', 'Tiller', 'Tiller extension', '# Spars and sail', 'Mast', 'Mast bag', 'Boom with 2 blocks', 'Sprit', 'Sprit halyard / adjuster', 'Sprit hooks (×2)',
          'Sail with bag', 'Battens (×3)', 'Sail ties', 'Wind indicator', '# Rigging', 'Mainsheet', 'Ratchet block', 'Block', 'Vang', 'Cunningham', 'Outhaul', 'Triangle line',
          'Spring', 'Shackle', 'Safety pins (×2)', '# On board', 'Paddle with line', 'Bailer', 'Painter / tow line', 'Protest flag', '# Ashore', 'Cover', 'Launching trolley'],
        tools: ['# Small box (every sailor, in the locker)', 'Pliers', 'Screwdrivers, flat + Phillips (or bit set)', 'Sailing knife on a neck cord', 'Needle + synthetic thread',
          'Wide packing tape', 'Spare lines', 'Scissors', 'Wet sandpaper 120 / 240 / 400', 'Sandpaper', 'Shackles', 'Hammer',
          '# Also bring', 'Sponge', '10 L bucket with rope', '# Regatta box (coach / van)', 'Small first-aid kit', 'Sail repair tape', 'Drill (battery or hand) + bit set',
          'Pop-rivet gun + rivets (aluminium + stainless)', 'Spanners 4–22 + adjustable spanner', 'Locking pliers (vise-grip)', 'Hacksaw', 'Stainless screws, bolts, nuts, washers',
          'Stainless wire + crimps + crimp pliers', 'Torch + spare batteries', 'Putty knives (×2)', 'WD-40', 'Small clamps', 'Extension cord'],
        transport: C.dTrans,
        other: ['Sunscreen', 'Sunglasses', 'Water bottle', 'Watch', 'Racing rules book', 'Phone + charger', 'NoR / SI', 'Measurement certificate / class membership', 'Entry confirmation / ID',
          '# Accommodation / camp', 'Sleeping bag', 'Pillowcase', 'Sheets (×2)', 'Toiletries', 'Towel', 'Hair dryer', 'Alarm clock', 'Torch', 'Pen + notebook',
          'Washing line + pegs (×10)', 'Large bin bags (×5)', 'Spoon, knife, bowl / small pot', 'Liquid soap', 'Heater', 'Candle + matches'],
        fnb: C.fnb,
        medical: cat(['Chafing ointment / petroleum jelly'], C.medical)
      } },

    { id: 'pub-420', name: '420', cls: '420', draft: true, source: DRAFT,
      subs: {
        clothing: cat(C.dinghy, C.hike, C.trap),
        boat: ['# Hull', 'Bungs / transom flaps OK', 'Self-bailers work', 'Buoyancy hatches closed', 'Hiking straps secure',
          '# Rig', 'Mast, spreaders, shrouds, forestay', 'Rig tension set (gauge)', 'Shroud pins taped / ring dings', 'Halyards (main, jib, spinnaker)', 'Trapeze wires, handles, adjusters',
          '# Sails', 'Mainsail + battens', 'Jib', 'Spinnaker + pole', 'Sail numbers', '# Sheets and controls', 'Mainsheet', 'Jib sheets', 'Spinnaker sheets / guys', 'Vang, cunningham, outhaul',
          '# Foils', 'Centreboard + up/downhaul', 'Rudder + retaining clip', 'Tiller + extension'],
        tools: cat(C.tools, C.rigTools), transport: C.dTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } },

    { id: 'pub-470', name: '470', cls: '470', draft: true, source: DRAFT,
      subs: {
        clothing: cat(C.dinghy, C.hike, C.trap),
        boat: ['# Hull', 'Bungs / transom flaps OK', 'Self-bailers work', 'Buoyancy hatches closed', 'Hiking straps secure',
          '# Rig', 'Mast, spreaders, shrouds, forestay', 'Rig tension and rake set (gauge)', 'Mast ram / chocks set', 'Shroud pins taped / ring dings', 'Halyards (main, jib, spinnaker)',
          'Trapeze wires, handles, adjusters', '# Sails', 'Mainsail + battens', 'Jib', 'Spinnaker + pole / launcher', 'Sail numbers',
          '# Sheets and controls', 'Mainsheet', 'Jib sheets + adjustable leads', 'Spinnaker sheets / guys', 'Vang, cunningham, outhaul',
          '# Foils', 'Centreboard + up/downhaul', 'Rudder + retaining clip', 'Tiller + extension'],
        tools: cat(C.tools, C.rigTools), transport: C.dTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } },

    { id: 'pub-j70', name: 'J/70', cls: 'J/70', draft: true, source: DRAFT,
      subs: {
        clothing: C.keel,
        boat: ['# Hull and keel', 'Keel down, lifting pin / bolts secure', 'Rudder + tiller + extension', 'Bilge dry, pump works', 'Hatches closed',
          '# Rig', 'Rig tuned for conditions (tuning guide)', 'Shroud pins taped / ring dings', 'Halyards free', 'Bowsprit extends and retracts',
          '# Sails', 'Mainsail + battens', 'Jib', 'Asymmetric spinnaker packed', 'Sail numbers', '# Sheets and controls', 'Main and jib sheets', 'Spinnaker sheets + tack line',
          'Vang, cunningham, outhaul, backstay / controls', '# Safety and equipment', 'Outboard + bracket + fuel (if used)', 'Anchor + line', 'Paddle', 'Bucket', 'Throw line',
          'Horn', 'Crew weight within class limit', 'Safety equipment per NoR / class rules'],
        tools: cat(C.tools, C.rigTools), transport: C.kTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } },

    { id: 'pub-m24', name: 'Melges 24', cls: 'Melges 24', draft: true, source: DRAFT,
      subs: {
        clothing: C.keel,
        boat: ['# Hull and keel', 'Keel down and locked (hoist secured)', 'Rudder + tiller + extension', 'Bilge dry, pump works', 'Hatches closed',
          '# Rig', 'Rig tuned for conditions (tuning guide)', 'Shroud pins taped / ring dings', 'Halyards free', 'Bowsprit extends and retracts',
          '# Sails', 'Mainsail + battens', 'Jib', 'Asymmetric spinnaker packed', 'Sail numbers', '# Sheets and controls', 'Main and jib sheets', 'Spinnaker sheets + tack line',
          'Vang, cunningham, outhaul', 'Hiking lifelines secure', '# Safety and equipment', 'Outboard + fuel (if used)', 'Anchor + line', 'Paddle', 'Bucket', 'Throw line', 'Horn',
          'Crew weight within class limit', 'Safety equipment per NoR / class rules'],
        tools: cat(C.tools, C.rigTools), transport: C.kTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } },

    { id: 'pub-finn', name: 'Finn', cls: 'Finn', draft: true, source: DRAFT,
      subs: {
        clothing: cat(C.dinghy.slice(0, 2), C.hike, C.dinghy.slice(2)),
        boat: ['# Hull', 'Self-bailers work', 'Buoyancy / hatches closed', 'Hiking strap secure and adjusted', '# Spars', 'Mast: no cracks at deck and heel', 'Mast wedges / chocks set',
          'Boom + gooseneck', '# Sail and controls', 'Mainsail + battens', 'Sail numbers', 'Mainsheet + ratchet block', 'Vang / kicker', 'Cunningham', 'Outhaul', 'Inhaul / traveller (if fitted)',
          '# Foils', 'Centreboard + up/downhaul', 'Rudder + retaining clip', 'Tiller + extension'],
        tools: C.tools, transport: C.dTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } },

    { id: 'pub-49er', name: '49er / 49erFX', cls: '49er', draft: true, source: DRAFT,
      subs: {
        clothing: cat(C.dinghy, C.trap, ['Trapeze harness (helm)'], C.fast),
        boat: ['# Hull and wings', 'Hull drained, no leaks', 'Wings / racks secure', 'Hiking / foot straps', '# Rig', 'Mast sections joined and taped', 'Shrouds, forestay, spreaders',
          'Rig tension set', 'Trapeze wires (both sides, helm + crew)', 'Halyards free', '# Sails', 'Mainsail + battens', 'Self-tacking jib', 'Gennaker + launcher / chute', 'Bowsprit', 'Sail numbers',
          '# Controls', 'Mainsheet', 'Jib sheet', 'Gennaker sheets + halyard / retrieval', 'Vang, downhaul / cunningham, outhaul', '# Foils', 'Centreboard', 'Rudder + gantry', 'Tiller + extensions', 'Righting line'],
        tools: cat(C.tools, C.rigTools), transport: C.dTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } },

    { id: 'pub-n17', name: 'Nacra 17', cls: 'Nacra 17', draft: true, source: DRAFT,
      subs: {
        clothing: cat(C.dinghy, C.trap, ['Trapeze harness (helm)'], C.fast),
        boat: ['# Platform', 'Hulls drained, inspection ports closed', 'Beams and bolts secure', 'Trampoline laced and tight', 'Hiking / foot straps', '# Rig', 'Mast, diamonds, shrouds, forestay',
          'Rig tension / rake set', 'Trapeze wires (both sides)', 'Halyards free', '# Sails', 'Mainsail + battens (tension)', 'Jib', 'Gennaker + snuffer / bag', 'Bowsprit / pole', 'Sail numbers',
          '# Foils', 'Daggerboards: no damage, bearings OK', 'Rudders + T-foils / elevators', 'Rudder rake / elevator settings', 'Foil covers removed and stowed', 'Tiller cross-bar + extensions',
          '# Controls', 'Mainsheet + traveller', 'Jib sheets', 'Gennaker sheets', 'Downhaul, outhaul', 'Righting line'],
        tools: cat(C.tools, C.rigTools, ['Foil repair kit']), transport: C.cTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } },

    { id: 'pub-moth', name: 'Moth (foiling)', cls: 'Moth', draft: true, source: DRAFT,
      subs: {
        clothing: cat(C.dinghy.slice(0, 2), C.hike, C.dinghy.slice(2), C.fast),
        boat: ['# Hull and wings', 'Hull drained, no leaks', 'Wing frames / racks secure', 'Tramps tight', '# Foils', 'Main foil: no damage, bolts / pins secure', 'Rudder foil: no damage, pins secure',
          'Foil fairings in place', 'Foil covers removed and stowed', '# Ride-height system', 'Wand + wand mount', 'Wand linkage / pushrod free', 'Ride-height adjuster works',
          '# Rig', 'Mast + shrouds / spreaders', 'Mainsail: battens, cams', 'Boom', 'Vang', 'Cunningham / downhaul', 'Outhaul', 'Mainsheet', 'Sail numbers',
          '# Steering', 'Rudder gantry secure', 'Tiller + extension', 'Rake adjuster works'],
        tools: cat(C.tools, ['Foil repair kit', 'Spare wand']), transport: C.dTrans, other: C.other, fnb: C.fnb, medical: C.medical
      } }
  ];
})();
