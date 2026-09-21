// 招财猫银行 · 安卓客户端
//
// 两个模块：
//   :app       —— 安卓应用（Compose）
//   :contract  —— **纯 JVM**：桥接接口面的类型、SSE 解析、契约测试。
//                 刻意不依赖 Android SDK，所以不需要模拟器就能跑，
//                 也因此能在 CI/命令行里立刻验证 `/agent-api/*` 的形状。
//
// 仓库镜像：本机 ~/.gradle/init.gradle 已经注入镜像，这里再显式写一遍，
// 让工程自解释（换台机器也不会因为默认走 dl.google.com 而慢到不可用）。

pluginManagement {
    repositories {
        maven("https://repo.huaweicloud.com/repository/maven/")
        maven("https://mirrors.cloud.tencent.com/nexus/repository/maven-public/")
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.huaweicloud.com/repository/maven/")
        maven("https://mirrors.cloud.tencent.com/nexus/repository/maven-public/")
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
        google()
        mavenCentral()
    }
}

rootProject.name = "luckycat-android"

include(":app")
include(":contract")
include(":domain")
