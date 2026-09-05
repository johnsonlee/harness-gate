plugins { `java-library`; `maven-publish` }
java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }
dependencies { implementation("org.ow2.asm:asm-commons:9.7.1") }
publishing { publications { create<MavenPublication>("rules") { from(components["java"]) } } }
