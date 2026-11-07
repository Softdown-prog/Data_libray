/**
 * Compare independent official Angular build receipts supplied by a host.
 * No execution, no cache-hit attestation, no deployment permission.
 */
const HASH=/^[0-9a-f]{64}$/;
const result=(status,code)=>Object.freeze({
 schema_version:1,kind:'angular-aot-incremental-artifact-concordance',
 status,code,cache_hit_verified:false,production_aot_verified:false,
 browser_verified:false,root_cause_verified:false,deployment_authorized:false
});
export function compareAngularIncrementalEvidence(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    ![input.baseline_sha256,input.warm_sha256,input.cold_sha256]
      .every(x=>typeof x==='string'&&HASH.test(x)))
   return result('unverified','incomplete-artifact-digests');
 if(input.baseline_build_pass!==true||input.warm_build_pass!==true||
    input.cold_build_pass!==true||input.negative_build_failed!==true||
    input.negative_diagnostic!=='TS2339')
   return result('unverified','official-aot-sequence-incomplete');
 if(input.baseline_sha256===input.warm_sha256)
   return result('fail','stale-artifact-not-updated');
 if(input.warm_sha256!==input.cold_sha256)
   return result('fail','incremental-clean-artifact-divergence');
 return result('pass','warm-clean-output-concordant');
}
