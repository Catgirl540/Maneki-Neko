package com.moneymeow.bank

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * 助手回复的 Markdown + KaTeX 渲染。
 *
 * 为什么用 WebView 而不是纯 Compose：公式需要 KaTeX，而 KaTeX 是 JS。
 * 只内置 `katex.min.js`（MathML 输出，不需要字体包），正文样式由注入的 CSS
 * 对齐 App 的设计 token（字号 12.5、行高 19、主色 #061B31、代码底色 #F6F9FC）。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MarkdownMessage(markdown: String, modifier: Modifier = Modifier) {
    val html = remember(markdown) { Markdown.renderHtml(markdown) }
    var heightPx by remember(html) { mutableIntStateOf(0) }

    AndroidView(
        modifier = modifier
            .fillMaxWidth()
            // WebView 报的是 CSS px，与 dp 近似 1:1，不要再乘/除 density
            .then(if (heightPx > 0) Modifier.height(heightPx.dp) else Modifier.height(24.dp)),
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = false
                settings.allowFileAccess = true
                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = false
                overScrollMode = WebView.OVER_SCROLL_NEVER
                webViewClient = WebViewClient()
                addJavascriptInterface(
                    object {
                        @android.webkit.JavascriptInterface
                        fun onHeight(px: Int) {
                            heightPx = px
                        }
                    },
                    "AndroidBridge",
                )
                loadDataWithBaseURL("file:///android_asset/", html, "text/html", "utf-8", null)
            }
        },
        update = { webView ->
            if (webView.tag != html) {
                webView.tag = html
                webView.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "utf-8", null)
            }
        },
    )
}

/** 极简 Markdown → HTML，够用就好；公式交给 KaTeX。 */
object Markdown {
    fun renderHtml(source: String): String {
        val body = StringBuilder()
        val lines = source.replace("\r\n", "\n").split('\n')
        var index = 0
        var inCode = false
        var codeBuffer = StringBuilder()
        var listType: String? = null

        fun closeList() {
            listType?.let { body.append("</$it>\n") }
            listType = null
        }

        while (index < lines.size) {
            val raw = lines[index]
            val line = raw.trimEnd()

            if (line.startsWith("```")) {
                if (!inCode) {
                    closeList()
                    inCode = true
                    codeBuffer = StringBuilder()
                } else {
                    body.append("<pre><code>").append(escape(codeBuffer.toString())).append("</code></pre>\n")
                    inCode = false
                }
                index++
                continue
            }
            if (inCode) {
                codeBuffer.append(raw).append('\n')
                index++
                continue
            }

            when {
                line.isBlank() -> closeList()
                line.matches(Regex("^#{1,6}\\s+.*")) -> {
                    closeList()
                    val level = line.takeWhile { it == '#' }.length
                    body.append("<h$level>").append(inline(line.drop(level).trim())).append("</h$level>\n")
                }
                line.startsWith(">") -> {
                    closeList()
                    body.append("<blockquote>").append(inline(line.removePrefix(">").trim())).append("</blockquote>\n")
                }
                line.matches(Regex("^[-*+]\\s+.*")) -> {
                    if (listType != "ul") {
                        closeList()
                        listType = "ul"
                        body.append("<ul>\n")
                    }
                    body.append("<li>").append(inline(line.drop(2).trim())).append("</li>\n")
                }
                line.matches(Regex("^\\d+[.)]\\s+.*")) -> {
                    if (listType != "ol") {
                        closeList()
                        listType = "ol"
                        body.append("<ol>\n")
                    }
                    body.append("<li>").append(inline(line.replaceFirst(Regex("^\\d+[.)]\\s+"), ""))).append("</li>\n")
                }
                line == "---" || line == "***" -> {
                    closeList()
                    body.append("<hr/>\n")
                }
                else -> {
                    closeList()
                    // 表格：连续的 | 行
                    if (line.startsWith("|") && lines.getOrNull(index + 1)?.trimStart()?.startsWith("|") == true) {
                        body.append("<table>\n")
                        var first = true
                        while (index < lines.size && lines[index].trimStart().startsWith("|")) {
                            val cells = lines[index].trim().trim('|').split('|').map { it.trim() }
                            if (cells.all { it.matches(Regex("^:?-{2,}:?$")) }) {
                                index++
                                continue
                            }
                            val tag = if (first) "th" else "td"
                            body.append("<tr>")
                            cells.forEach { body.append("<$tag>").append(inline(it)).append("</$tag>") }
                            body.append("</tr>\n")
                            first = false
                            index++
                        }
                        body.append("</table>\n")
                        continue
                    }
                    body.append("<p>").append(inline(line)).append("</p>\n")
                }
            }
            index++
        }
        if (inCode) body.append("<pre><code>").append(escape(codeBuffer.toString())).append("</code></pre>\n")
        closeList()

        return """
<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:transparent;}
  body{font-family:-apple-system,'PingFang SC','Noto Sans CJK SC',sans-serif;font-size:12.5px;line-height:19px;color:#061B31;word-break:break-word;}
  p{margin:0 0 8px;}
  h1,h2,h3,h4{font-size:14px;font-weight:600;margin:10px 0 6px;}
  ul,ol{margin:0 0 8px;padding-left:18px;}
  li{margin:2px 0;}
  code{font-family:'SF Mono',Menlo,monospace;font-size:11.5px;background:#F6F9FC;border-radius:4px;padding:1px 4px;}
  pre{background:#F6F9FC;border-radius:6px;padding:8px 10px;overflow-x:auto;margin:0 0 8px;}
  pre code{background:transparent;padding:0;}
  blockquote{margin:0 0 8px;padding-left:10px;border-left:2px solid #E5EDF5;color:#4E6078;}
  table{border-collapse:collapse;margin:0 0 8px;font-size:12px;}
  th,td{border:1px solid #E5EDF5;padding:4px 8px;text-align:left;}
  th{background:#F6F9FC;font-weight:600;}
  hr{border:none;border-top:1px solid #E5EDF5;margin:8px 0;}
  a{color:#533AFD;text-decoration:none;}
  .katex-display{margin:8px 0;overflow-x:auto;overflow-y:hidden;}
  strong{font-weight:600;}
</style>
<script src="katex.min.js"></script>
</head><body>
$body
<script>
  // 行内/块级公式：$...$ 与 $$...$$
  (function(){
    function render(tex, display){
      try {
        return katex.renderToString(tex, {displayMode: display, output: 'mathml', throwOnError: false});
      } catch (e) { return null; }
    }
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(node){
      var text = node.nodeValue;
      if (!text || text.indexOf('$') === -1) return;
      var replaced = text
        .replace(/\$\$([^$]+)\$\$/g, function(_, tex){ var h = render(tex, true); return h || _; })
        .replace(/\$([^$\n]+)\$/g, function(_, tex){ var h = render(tex, false); return h || _; });
      if (replaced !== text) {
        var span = document.createElement('span');
        span.innerHTML = replaced;
        node.parentNode.replaceChild(span, node);
      }
    });
  })();
  function report(){
    var h = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.getBoundingClientRect().height
    );
    if (window.AndroidBridge) window.AndroidBridge.onHeight(Math.ceil(h));
  }
  report();
  setTimeout(report, 80);
  setTimeout(report, 250);
  setTimeout(report, 600);
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
</script>
</body></html>
""".trimIndent()
    }

    /** 行内格式：粗体、斜体、行内代码、链接。公式留给页面里的 KaTeX。 */
    private fun inline(text: String): String {
        var out = escape(text)
        out = out.replace(Regex("`([^`]+)`"), "<code>$1</code>")
        out = out.replace(Regex("\\*\\*([^*]+)\\*\\*"), "<strong>$1</strong>")
        out = out.replace(Regex("(?<!\\*)\\*([^*]+)\\*(?!\\*)"), "<em>$1</em>")
        out = out.replace(Regex("\\[([^]]+)]\\(([^)]+)\\)"), "<a href=\"$2\">$1</a>")
        return out
    }

    private fun escape(text: String): String = text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
}
