// :domain —— 应用逻辑，**纯 JVM**。
//
// 为什么不塞进 :app：登录规则、会话存档这些是**真逻辑**，用 instrumented 测试
// （要模拟器、慢、还可能抖）去验它们是浪费。放这里就能 `./gradlew :domain:test`，
// 和网页版那批离线 check-*.mjs 一个意思。
//
// 为什么不塞进 :contract：:contract 是"桥接接口面"的定义，登录和存档跟桥接无关。
plugins {
    `java-library`
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    // 会话存档要 JSON，挑战的展示模型要用 :contract 里的类型
    api(project(":contract"))
    api(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
}

tasks.withType<Test>().configureEach {
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = false
    }
}
