// 根构建脚本：只声明插件，不 apply（各模块自己 apply）。
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
}

// 扫「注释里嵌套了块注释」。
//
// 为什么要做成构建任务：Kotlin 的块注释**可以嵌套**，所以在 KDoc 里写
// 以 斜杠星号 结尾的路径（例如描述路由前缀那种写法）时，那个符号会开一个
// 永远闭合不了的嵌套注释。Kotlin 编译器报的是 "Unclosed comment" 并且
// **指向文件末尾**——排查方向完全是错的。本项目里为此白折腾过六次。
//
// 之前它只是 scripts/gate.sh 里的一条 grep，而那要人**记得先跑**；
// 实际发生的几次全是"写完直接 build"的时候。挂到编译任务前面就不会再有。
//
// 只查**注释续行**（行首是星号）：那里的斜杠星号一定在注释体内部。
// 行首就是注释开头的属于合法写法，不能一并算进去。
// 覆盖不到单行注释里夹路径通配符的情况——这条检查不完备，但已知的坑它都能抓。
val checkNestedComments = tasks.register("checkNestedComments") {
    group = "verification"
    description = "扫出注释里嵌套的块注释（会导致 Unclosed comment）"

    val sources = fileTree(rootDir) {
        include("**/*.kt", "**/*.kts")
        exclude("**/build/**")
    }
    inputs.files(sources).withPropertyName("kotlinSources")

    doLast {
        // 行首（允许空白）是星号，且这一行里还有斜杠星号
        val pattern = Regex("^\\s*\\*.*/\\*")
        val offenders = mutableListOf<String>()
        sources.forEach { file ->
            file.readLines().forEachIndexed { index, line ->
                if (pattern.containsMatchIn(line)) {
                    offenders += "${file.relativeTo(rootDir)}:${index + 1}: ${line.trim()}"
                }
            }
        }
        if (offenders.isNotEmpty()) {
            throw GradleException(
                buildString {
                    appendLine("注释里嵌套了块注释（把斜杠星号改成省略号，或去掉那个斜杠）：")
                    offenders.take(20).forEach { appendLine("  $it") }
                    if (offenders.size > 20) appendLine("  …还有 ${offenders.size - 20} 处")
                },
            )
        }
    }
}

// 任何 Kotlin 编译之前先跑它。用 matching + configureEach 而不是遍历 tasks：
// 各模块的任务在配置阶段才注册，遍历会漏。
subprojects {
    tasks.matching { it.name.startsWith("compile") && it.name.endsWith("Kotlin") }.configureEach {
        dependsOn(checkNestedComments)
    }
}
