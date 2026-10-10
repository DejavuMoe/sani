Object.assign(SCENES, {
  'r8-dashboard': {group:'R8'},
  'r8-settings': {group:'R8',route:'settings',config:{timezone:'Local'}},
  'r8-settings-long': {group:'R8',route:'settings',config:{timezone:'America/Argentina/Buenos_Aires',filesUrl:'https://files.long-example-domain.example.com'}},
  'r8-settings-off': {group:'R8',route:'settings',config:{timezone:'Local',filesUrl:null}},
  'r8-empty': {group:'R8',store:{empty:true}},
  'r8-setup': {group:'R8',session:'setup'},
  'r8-shortcuts': {group:'R8',shortcuts:true},
});
