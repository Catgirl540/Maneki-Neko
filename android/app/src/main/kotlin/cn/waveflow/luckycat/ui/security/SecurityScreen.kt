package cn.waveflow.luckycat.ui.security

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.waveflow.luckycat.contract.bank.SecurityLog
import cn.waveflow.luckycat.domain.time.Dates
import cn.waveflow.luckycat.ui.theme.Palette

/**
 * 安全中心：评分 + 风控规则 + 登录设备 + 安全日志。
 *
 * **每条规则都把"它在拦什么"完整显示出来**——「境外交易拦截」这五个字
 * 看不出它到底拦什么，而用户是在这里决定要不要关掉自己的保护。
 */
@Composable
fun SecurityScreen(state: SecurityUiState, onToggleRule: (String, Boolean) -> Unit, onRetry: () -> Unit) {
    val overview = state.overview
    if (state.loading && overview == null) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.testTag("security-loading"))
        }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("安全中心", style = MaterialTheme.typography.headlineSmall)

        state.error?.let {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f).testTag("security-error"),
                )
                TextButton(onClick = onRetry, modifier = Modifier.testTag("security-retry")) { Text("重试") }
            }
        }

        overview?.let { data ->
            ScoreCard(score = data.score, level = data.level, identityVerified = data.identityVerified)

            SectionTitle("风控规则")
            data.riskRules.forEach { rule ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Palette.surface)
                        .padding(14.dp)
                        .testTag("rule-${rule.id}"),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(rule.label, style = MaterialTheme.typography.bodyLarge)
                        Switch(
                            checked = rule.enabled,
                            onCheckedChange = { onToggleRule(rule.id, it) },
                            enabled = state.busyRuleId != rule.id,
                            modifier = Modifier.testTag("rule-switch-${rule.id}"),
                        )
                    }
                    // 完整描述，不省略：用户是在这里决定要不要关掉保护
                    Text(
                        rule.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = Palette.inkSoft,
                        modifier = Modifier.testTag("rule-desc-${rule.id}"),
                    )
                }
            }

            if (data.devices.isNotEmpty()) {
                SectionTitle("登录设备（${data.devices.size}）")
                data.devices.forEach { device ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(Palette.surface)
                            .padding(14.dp)
                            .testTag("device-${device.id}"),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(device.name, style = MaterialTheme.typography.bodyLarge)
                            if (device.current) {
                                Text("本机", style = MaterialTheme.typography.bodySmall, color = Palette.accentDeep)
                            }
                        }
                        Text(
                            "${device.location} · 最近活跃 ${Dates.dateTime(device.lastActiveAt)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = Palette.inkMute,
                        )
                    }
                }
            }

            if (data.logs.isNotEmpty()) {
                SectionTitle("安全日志")
                data.logs.forEach { log -> LogRow(log) }
            }
        }
    }
}

@Composable
private fun ScoreCard(score: Int, level: String, identityVerified: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Palette.surface)
            .padding(16.dp)
            .testTag("security-score"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("安全评分", style = MaterialTheme.typography.bodySmall, color = Palette.inkSoft)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                score.toString(),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.testTag("security-score-value"),
            )
            Text(level, style = MaterialTheme.typography.bodyMedium, color = Palette.accentDeep)
        }
        Text(
            if (identityVerified) "身份已验证" else "身份未验证——敏感操作前需要先完成验证",
            style = MaterialTheme.typography.bodySmall,
            color = if (identityVerified) Palette.income else MaterialTheme.colorScheme.error,
            modifier = Modifier.testTag("security-identity"),
        )
    }
}

@Composable
private fun LogRow(log: SecurityLog) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.sunk)
            .padding(12.dp)
            .testTag("log-${log.id}"),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(log.action, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(log.detail, style = MaterialTheme.typography.bodySmall, color = Palette.inkMute)
        }
        Text(
            Dates.dateTime(log.createdAt),
            style = MaterialTheme.typography.bodySmall,
            color = Palette.inkMute,
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
}
