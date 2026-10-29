import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The release key stays off the repository: ~/.lakeba/lex-signing.properties (storeFile, storePassword,
// keyAlias, keyPassword). Without it the release build comes out unsigned.
val signing = Properties().apply {
    val f = File(System.getProperty("user.home"), ".lakeba/lex-signing.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.lakeba.lex"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.lakeba.lex"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        // The portal the tablet opens: production by default; the debug build (for testing) opens staging.
        buildConfigField("String", "PORTAL", "\"https://investors.lakeba.com\"")
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) create("release") {
            storeFile = file(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            buildConfigField("String", "PORTAL", "\"https://giuseppe-macbook-pro.tail21d16f.ts.net\"")
            resValue("string", "app_name", "Lex (staging)")
        }
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
            resValue("string", "app_name", "Lex")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
