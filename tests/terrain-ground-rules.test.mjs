import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompleteScenePrompt,buildNativeScenePrompt,GROUND_RULES} from '../server/ai/complete-terrain.mjs';
test('both image routes use identical ground footprint, thin uniform base and mountain-safe edge rules',()=>{
 for(const build of [buildCompleteScenePrompt,buildNativeScenePrompt]){
  const prompt=build('主景为山脚下的一间小屋，内部有山坡和树木。');
  assert.equal(prompt.positive.split(GROUND_RULES).length,2);
  for(const text of ['1.68:1','83%','55.3%','3%','左右两侧厚度一致','同一基准面','地块内部高于','不要把所有内部地形压平','不裁断主体','不画翘边、卷边','四条笔直边','不要把所有内部地形压平'])assert.ok(GROUND_RULES.includes(text),text);
  assert.ok(prompt.positive.indexOf(GROUND_RULES)<prompt.positive.indexOf('主景为山脚'));
 }
});
test('route-specific background and native no-negative-prompt contracts stay intact',()=>{
 const white=buildCompleteScenePrompt('完整主景'),native=buildNativeScenePrompt('主景在白色背景');
 assert.equal(white.version,'isometric-complete-scene-v5');assert.equal(native.version,'isometric-native-alpha-v3');
 assert.match(white.positive,/RGB\(255,255,255\)/);assert.match(native.positive,/RGBA/);assert.equal(native.negative,'');
 assert.doesNotMatch(native.scene,/白色背景/);assert.doesNotMatch(native.positive,/两侧土壤厚度全部保留/);
});
