plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "cn.waveflow.luckycat"
    compileSdk = 36

    defaultConfig {
        applicationId = "cn.waveflow.luckycat"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        // instrumented 测试要跑在模拟器/真机上。用 MockWebServer 喂固定 SSE，
        // 所以这一层不依赖真模型、不花钱、也不会因为上游抖动而红。
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // agent 桥接的**主机根**，构建期注入，界面不再靠手输。
        //
        // 默认走**公网**：https://bank.waveflow.cn 的 /agent-api/ 由服务器上的
        // nginx 反代到 luckycat-bridge（systemd 服务）。手机装上就能用，
        // 不依赖电脑开着、也不要求同一个 WiFi。
        //
        // ⚠️ 这里**只到主机根**，不带 /agent-api —— 那个前缀由 :contract 的
        // AgentApi 自己拼（见它的 KDoc 与 init 断言）。带上会拼成
        // /agent-api/agent-api/…，服务端 404。
        //
        // 本地联调覆盖：
        //   模拟器  ./gradlew :app:installDebug -Pluckycat.agentBase=http://10.0.2.2:8788
        //   真机同网 ./gradlew :app:installDebug -Pluckycat.agentBase=http://<电脑局域网IP>:8788
        val agentBase = (project.findProperty("luckycat.agentBase") as String?)
            ?: "https://bank.waveflow.cn"
        buildConfigField("String", "AGENT_BASE", "\"$agentBase\"")
    }

    buildFeatures {
        compose = true
        // BuildConfig 要显式打开（AGP 8 起默认关）
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    buildTypes {
        release {
            // 演示阶段先不混淆：混淆了以后崩溃栈没法看，而这一步的目标是能跑起来
            isMinifyEnabled = false
        }
    }
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    // 接口面只有一份定义，在 :contract 里（纯 JVM，可脱离模拟器测试）
    implementation(project(":contract"))
    // 界面之外的真逻辑（金额格式、手机号规则），同样脱离模拟器可测
    implementation(project(":domain"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)

    implementation(libs.kotlinx.coroutines.android)

    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(libs.junit)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}
