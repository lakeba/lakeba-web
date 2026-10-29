plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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

    buildTypes {
        debug {
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            buildConfigField("String", "PORTAL", "\"https://giuseppe-macbook-pro.tail21d16f.ts.net\"")
            resValue("string", "app_name", "Lex (staging)")
        }
        release {
            isMinifyEnabled = false
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
