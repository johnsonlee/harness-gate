plugins { `java-library`; `maven-publish` }
java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }
dependencies { compileOnly("com.android.tools.lint:lint-api:31.9.1") }
publishing { publications { create<MavenPublication>("lint") { from(components["java"]) } } }
dependencies { testImplementation("com.android.tools.lint:lint-tests:31.9.1"); testImplementation("junit:junit:4.13.2") }
dependencies { testImplementation("com.android.tools.lint:lint-api:31.9.1") }
