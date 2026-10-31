import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Lakeba CRM on the salesperson's phone: the portal's CRM in an app, plus a prompt after each call.
// The release key stays off the repository: ~/.lakeba/crm-signing.properties (storeFile, storePassword,
// keyAlias, keyPassword). Without it the release build comes out unsigned.
val signing = Properties().apply {
    val f = File(System.getProperty("user.home"), ".lakeba/crm-signing.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.lakeba.crm"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.lakeba.crm"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        // The portal the app opens (a venture's CRM address can be set in the app's settings).
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
            resValue("string", "app_name", "CRM (staging)")
        }
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
            resValue("string", "app_name", "Lakeba CRM")
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
