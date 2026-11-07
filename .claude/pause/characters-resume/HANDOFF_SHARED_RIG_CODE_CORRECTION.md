# Shared-rig P2 correction — Appendix C.2 handoff

Worktree /Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41
Branch task/P1-E05-T01;clean HEAD d41d602b88025346b10cb9acce0b9668cfe7788b
Correction diff base d00d61ba5be3935f63feb7a91a8d0104d44e6cf7
Whole-task diff base00eed30402686fd717d8dd84d09e409dfd093ec9
Resolved contract on parent main d11e26b539205b7158cd4af7e2c789fa121a6a36;branch's packet-bound DESIGN/art-bible/plan references deliberately unchanged per parent instruction. Parent combines spec update at merge.

Production API: packages/client/src/characters/sharedRig.js
Usage/limited contract: packages/client/src/characters/SHARED_RIG.md
Tests: packages/client/src/characters/sharedRig.test.js
Read-only actual-GLB loader proof: packages/client/test/characters/loadActualRig.js
Report: assets/renders/characters/validate/shared-rig-contract/REPORT.json SHA 8e34647cd1dbc2b2854845fc2ae9f79af7b2a0302b8502568583bd889c971eb6
Before/after numeric proof: samefolder translation-replay-before.json andadapter-actual-proof-final.json.
Original REVIEW.md,translation-replay script/json/log,actualGLB checks anddrainproof retained in samefolder withoriginal- prefix;executable evidence copied as.txt byte-identically so preserved source doesn't enter runtime/lint. Complete original review directory copied byte-identically under .claude/pause/characters-resume/shared-rig-contract/independent-review,withreview-preservation hashmanifest.

Reproduced before edits: Thalune0;Ixari0.06211050707245722m,5844samples;Ulgani0.06440258749218m,3795samples. Plain Node runner failed on existing TS parameter-property stripping;preserved failure,thenunchanged replay succeeded through projecttsx.
Adapter snapshots all loaded local boneTRS/parentage before animation;source clips carry explicit matching profileID. Translation targetBind+(key-sourceBind);rotation targetBind*inverse(sourceBind)*key;scale targetBind*(key/sourceBind). ReturnedThreeAnimationClip hasindependenttracks/times/values;no rig/profile/sourceclip mutation. Onlynormalabsolute localboneTRS+LINEAR/STEP;unsupported tracks/interpolation failexplicitly. No hardcodedcanonical bonepositions/names/count inproduction. Profiles derivedfromactualthreecanonicalGLBs,including69authored+neutralhelper joints.

42tests pass (21newadapter+21review),client/toolsTC,focusedESLint,explicitnewfileformatcheck,gitdiff--check. Actual9source-targetpairs checkall70bones anddeterministicverticesfrom96skinnedmeshnodes/fourLODsperexport;texture/material loadingomitted onlyinRAM withunchanged geometry/skin/morph/node/compressionJSONandBIN proof.
Neutral max sampled vertexdrift1.7706557267871736e-8m;bone translations exactly0;max normalized rotationdifference7.300048299977715e-8rad. Nine nonneutral/interpolatedTRS+roundtripcases pass. Vertexclaim is sampled;everyboneTRSischecked. No texture/render/appearance/performance/integratedplayback acceptance claim.
Initialunitattempt19/21:twoangularmetricfailuresfromFloat32 quaternionmagnitude inThree.angleTo correctedby normalizingcomparisonoperands withoutlooseningthresholds;failedlog retained. Finalexactsource42testsession82888 passed;finalCPUgates session70677. Sourceprofilecaptureneutralbeforemixer is anexplicit APIprecondition;sourceprofileIDs mustversioncanonicalbodyexport;T02/T04 ownlibrary/playback integration.

611uniquefrozenbindingsverifiedaftercommit:allthreecanonicalsource/exports,peerinventories,Ulgani179required+32support,packet/specrefs andexisting29implementationfiles. Frozen fifth packet SHA80ad60aa81e0700f1bdd1423073ba833dd267dbf68d69a2f98c09bed39efd40e unchanged. No sixthartrevision,source/map/export/render/capturehelper/reference edit. Parent-relayed fifthUlganiREVISE remainsfrozen;no regrade.
Directfinaldrain verified 2026-11-02T16:52:45.537171+00:00:45recordedPIDs/25groups absent;ownedidleassertions absent;no jobs. BothCPU/GPUholds present;releasegates absent. Intermediatefastsession79490 exited0 withoutnumericPIDrecord;notinvented;final fullyrecorded exactsource run supplies retainedproof.

Remaining: fresh independentwhole-taskcodereview againstresolvedmainspec+thiscorrection,thenparentmergedQA. T02actualanimations,T04integratedplayback andT13performancequalification remainseparate. HOLD,no furtherGPU/artwork/helpers/push/merge/rebase/parentdocs.
