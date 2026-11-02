import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// 发布签名只从本机忽略文件读取，密钥与口令不进仓库。
// 缺失时 release 构建为未签名包，打包脚本会因 apksigner 校验失败而拒绝发布。
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) FileInputStream(keystorePropertiesFile).use { load(it) }
}

// 后端地址：默认线上演示环境；本地联调用 -PbankBaseUrl=http://10.0.2.2:8081 覆盖。
val bankBaseUrl: String = (findProperty("bankBaseUrl") as String?) ?: "https://bank.waveflow.men"

android {
    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    namespace = "com.moneymeow.bank"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.moneymeow.bank"
        minSdk = 26
        targetSdk = 36
        versionCode = 8
        versionName = "1.0.7"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // 正式包不自动登录；dev 变体会覆盖成 true。
        buildConfigField("boolean", "AUTO_LOGIN_DEMO", "false")
        buildConfigField("String", "BANK_BASE_URL", "\"$bankBaseUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystorePropertiesFile.exists()) signingConfig = signingConfigs.getByName("release")
        }
        /**
         * 联调用 dev 包：独立包名可与正式包装在同一台设备，
         * 打开直接登录演示账户，不走登录页。
         */
        create("dev") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField("boolean", "AUTO_LOGIN_DEMO", "true")
        // 本地验证更新流程时指到测试站点；留空则用 assets/update.json 的线上地址
        buildConfigField("String", "UPDATE_MANIFEST_URL", "\"${project.findProperty("updateManifestUrl") ?: ""}\"")
            resValue("string", "app_name", "招财猫 Dev")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
}

dependencies {
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("junit:junit:4.13.2")
    implementation(platform("androidx.compose:compose-bom:2025.09.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
