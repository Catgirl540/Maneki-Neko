/** 验证真正发出的 OpenRouter 请求保留工具、认证和流式参数，不调用外部模型。 */
import assert from 'node:assert/strict'
import {createFallbackFetch} from '../framework/bridge/model-fallback-fetch.mjs'
const calls=[]
const response=new Response('data: test\n\n',{headers:{'content-type':'text/event-stream'}})
const send=createFallbackFetch(async(input,init)=>{calls.push(new Request(input,init));return response},['deepseek/deepseek-v4.1-flash','z-ai/glm-5.3-flash'])
const controller=new AbortController()
const body={model:'qwen/qwen3.8-flash',stream:true,messages:[{role:'user',content:'fixture'}],tools:[{type:'function',function:{name:'ping',parameters:{type:'object'}}}],max_tokens:2048}
const headers={authorization:'Bearer fixture-only','content-type':'application/json','content-length':String(JSON.stringify(body).length)}
assert.equal(await send('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal}),response)
const request=calls.pop();const actual=await request.json()
assert.deepEqual(actual.models,['qwen/qwen3.8-flash','deepseek/deepseek-v4.1-flash','z-ai/glm-5.3-flash'])
assert.equal(actual.model,undefined)
assert.deepEqual(actual.tools,body.tools);assert.deepEqual(actual.messages,body.messages)
assert.equal(actual.stream,true);assert.equal(request.headers.get('authorization'),'Bearer fixture-only')
assert.equal(request.headers.get('content-length'),null)
controller.abort();assert(request.signal.aborted)
await send(new Request('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers,body:JSON.stringify(body)}))
assert.deepEqual((await calls.pop().json()).models,actual.models)
for(const url of ['https://openrouter.ai/api/v1/audio/speech','https://example.com/api/v1/chat/completions']){
 await send(url,{method:'POST',headers,body:JSON.stringify(body)})
 assert.deepEqual(await calls.pop().json(),body)
}
await send('https://openrouter.ai/api/v1/chat/completions',{method:'POST',body:'invalid-json'})
assert.equal(await calls.pop().text(),'invalid-json')
console.log('PASS 备用模型顺序、工具参数、SSE、认证与取消信号保留；语音与其他接口不受影响')
