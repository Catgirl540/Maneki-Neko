// :contract —— 纯 JVM 模块。
//
// 刻意**不**依赖 Android SDK：这一层是"桥接接口面"的定义与验证，
// 不需要模拟器、不需要设备，`./gradlew :contract:test` 就能跑。
// 安卓端 (:app) 反过来依赖它，所以类型只有一份定义。
plugins {
    `java-library`
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        // 上游（OkHttp 的注解）里有 JSR-305 的空值标注，严格模式能把这些
        // 变成编译期错误，而不是运行期 NPE。
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

dependencies {
    // api：:app 会直接用 OkHttp 与 kotlinx.serialization 的类型
    api(libs.okhttp)
    api(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.withType<Test>().configureEach {
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = false
    }
}
