/**
 * SAC Core observational projection for the pinned LHS CI rehearsal.
 * Deliberately not a SAC RuleRegistry approval or authenticated build receipt.
 * Input JSON is bounded at the host adapter; this pure function emits only a
 * fixed-schema summary, never raw source, logs, endpoints or user data.
 */
const SHA40=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const SNAPSHOT_REPO='Softdown-prog/A7-forge-2D-';
const TARGETS=[
  ['canvas','src/main.ts','game/js/main.js','game'],
  ['save','src/site-rewrite/account.ts','game/js/sim/saveTransfer.js','save']
];
const fail=reason=>{throw new Error('sac-core-observation-'+reason);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sameKeys=(x,keys)=>plain(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const positive=x=>x===true;
const status=x=>x?'observed':'unverified';
const phase=(x,name)=>plain(x)&&x.phase===name&&x.navigation_status===200&&
  x.canvas_import_status===200&&x.angular_bootstrap===true&&x.touch_emulation===true&&
  x.pageerror_count===0&&x.horizontal_overflow_px===0;
const savePhase=(x,name)=>plain(x)&&x.phase===name&&x.import_executed===true&&
  x.export_detected===true&&x.status===200;
const controls=(x,name,width)=>plain(x)&&x.phase===name&&x.viewport_width===width&&
  x.tab_switch===true&&x.options_open_close===true&&
  x.game_started===(name==='initial')&&x.saved_game_continued===(name==='reload')&&
  x.zoom_in_and_out===true&&x.fit_scene===true&&x.returned_to_menu===true&&
  plain(x.canvas_swipe)&&x.canvas_swipe.native_touch_swipe===true&&
  x.canvas_swipe.canvas_scrolled===true&&
  Number.isFinite(x.canvas_swipe.scroll_delta_px)&&x.canvas_swipe.scroll_delta_px>15&&
  x.canvas_swipe.game_clicks===0&&x.canvas_swipe.admin_remained_closed===true&&
  x.canvas_swipe.shop_remained_closed===true&&
  x.canvas_swipe.placement_remained_closed===true&&
  x.canvas_swipe.synthetic_post_drag_click_blocked===true;
const phone=(x,width,height)=>plain(x)&&x.viewport_width===width&&x.viewport_height===height&&
  x.no_page_errors===true&&
  Array.isArray(x.game)&&x.game.length===2&&
  Array.isArray(x.save)&&x.save.length===2&&
  Array.isArray(x.touch_controls)&&x.touch_controls.length===2&&
  ['initial','reload'].every((name,i)=>phase(x.game[i],name)&&
    savePhase(x.save[i],name)&&controls(x.touch_controls[i],name,width));

export function makeLhsObservationReport({sourceCommit,artifactEvidence,browserEvidence}={}){
  if(!SHA40.test(sourceCommit??''))fail('expected-commit-invalid');
  if(!plain(artifactEvidence)||!plain(browserEvidence))fail('input-missing');
  const a=artifactEvidence,b=browserEvidence;
  if(a.source_commit!==sourceCommit||b.source_commit!==sourceCommit)
    fail('source-mismatch');
  if(a.schema_version!==1||a.rule_id!=='SAC-PRE002-EXT'||
      a.probe!=='sac-pre002-lhs-pinned-angular-artifact-evidence'||
      a.scope!=='pinned-LHS-build-artifacts-only'||a.status!=='unverified'||
      a.runtime_execution_verified!==false||a.deployment_authorized!==false||
      b.schema_version!==1||b.rule_id!=='SAC-PRE002-EXT-BROWSER'||
      b.scope!=='isolated-loopback-browser-dynamic-imports'||
      b.browser!=='chromium'||b.server!=='127.0.0.1'||
      b.deployment_authorized!==false||b.gameplay_verified!==false||
      b.authentication_attempted!==false||b.payment_attempted!==false||
      b.browser_module_load_verified!==true)
    fail('contract-invalid');

  if(!Array.isArray(a.entries)||a.entries.length!==2||
      !Array.isArray(b.mobile_reload_evidence)||b.mobile_reload_evidence.length!==2)
    fail('coverage-shape-invalid');
  // Require the exact two known modules and matching digests. Never accept
  // arbitrary input-controlled paths as report fields.
  const hashes=[];
  let artifactsConsistent=a.emitted_artifacts_consistent===true&&
    a.angular_bootstrap_observed===true&&
    Number.isInteger(a.game_angular_js_chunks)&&a.game_angular_js_chunks>0&&a.game_angular_js_chunks<=64&&
    Number.isInteger(a.site_angular_js_chunks)&&a.site_angular_js_chunks>0&&a.site_angular_js_chunks<=64;
  let moduleResponsesOk=true;
  for(let i=0;i<TARGETS.length;i++){
    const [name,src,target,browserKey]=TARGETS[i];
    const e=a.entries[i],t=b[browserKey];
    if(!plain(e)||e.entry!==name||e.source_reference!==src||e.runtime_target!==target||
        !SHA256.test(e.target_sha256??''))fail('artifact-binding-invalid');
    const fields=['source_url_observed','source_dynamic_import_observed',
      'bundle_url_observed','bundle_dynamic_import_observed','target_file_present','artifact_link_evidence'];
    artifactsConsistent=artifactsConsistent&&fields.every(f=>positive(e[f]));
    hashes.push({entry:name,sha256:e.target_sha256});
    moduleResponsesOk=moduleResponsesOk&&plain(t)&&t.status===200&&t.javascript_mime===true&&
      t.csp_header===true&&t.sha256===e.target_sha256;
  }
  moduleResponsesOk=moduleResponsesOk&&plain(b.game)&&b.game.navigation_status===200&&
    b.game.canvas_response_status===200&&b.game.canvas_dynamic_request_observed===true&&
    b.game.angular_bootstrap===true&&b.game.pageerror_count===0&&
    b.save.dynamic_import_executed===true&&b.save.export_detected===true&&
    sameKeys(b.negative_tests,['missing_module_rejected','incorrect_mime_rejected','restrictive_csp_rejected'])&&
    Object.values(b.negative_tests).every(positive);

  const mobileChecks=[
    phone(b.mobile_reload_evidence[0],360,800),
    phone(b.mobile_reload_evidence[1],414,896)
  ];
  if(!Number.isInteger(b.external_network_blocked_count)||
      b.external_network_blocked_count<0||b.external_network_blocked_count>10000)
    fail('network-counter-invalid');
  const onlySafeResult={
    schema_version:1,
    report_type:'sac-core-external-observations',
    source:{repository:SNAPSHOT_REPO,commit:sourceCommit},
    scope:'pinned-LHS-isolated-CI-rehearsal',
    observation_status:'unverified',
    checks:{
      build:{observation:status(artifactsConsistent),approval:'unverified',
        detail:'compiled-artifact-presence-not-authenticated-build-receipt'},
      module_loading:{observation:status(moduleResponsesOk),approval:'unverified',
        detail:'loopback-http-mime-csp-and-chromium-imports'},
      interface:{observation:status(mobileChecks.every(Boolean)),approval:'unverified',
        viewports:[360,414],cycles_per_viewport:2,
        detail:'mobile-chromium-tap-reload-swipe-observations'},
      gameplay:{observation:'unverified',approval:'unverified',
        detail:'gameplay-and-real-device-not-tested'}
    },
    external_requests_blocked:b.external_network_blocked_count,
    artifact_digests:hashes,
    provenance:{cross_report_commit_match:true,runner_attestation_verified:false,
      official_build_receipt_verified:false},
    root_cause_verified:false,promotion_allowed:false,deployment_authorized:false
  };
  if(JSON.stringify(onlySafeResult).length>4096)fail('output-budget-exceeded');
  return onlySafeResult;
}
