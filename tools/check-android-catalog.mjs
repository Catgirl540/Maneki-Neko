import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { SPEND_PLATFORMS, FREE_SPEND_MERCHANTS } from '../shared/spend-platforms.mjs'
const path = new URL('../android-app/app/src/main/java/com/moneymeow/bank/SpendCatalog.kt', import.meta.url)
const text = `// Generated from shared/spend-platforms.mjs by tools/check-android-catalog.mjs --write.\npackage com.moneymeow.bank\n\ninternal data class SpendPlatform(val id: String, val name: String, val subscriptionAmount: Long = 0, val custom: Boolean = false)\ninternal val spendPlatforms = listOf(\n${[...SPEND_PLATFORMS, ...FREE_SPEND_MERCHANTS].map(row => `    SpendPlatform(${JSON.stringify(row.id)}, ${JSON.stringify(row.name)}, ${row.subscriptionAmount ?? 0}L, ${FREE_SPEND_MERCHANTS.some(item => item.id === row.id)}),`).join('\n')}\n)\n`
if (process.argv.includes('--write')) await writeFile(path, text)
else assert.equal(await readFile(path, 'utf8'), text, 'Regenerate the Android merchant catalog from the shared source')
console.log('PASS Android merchant, budget and subscription catalog matches shared source')
