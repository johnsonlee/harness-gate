package io.johnsonlee.harness.jvm;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.commons.ClassRemapper;
import org.objectweb.asm.commons.Remapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/** Reusable bytecode rules; does not load application classes or require Gradle. */
public final class PackageBoundaryRules {
    private PackageBoundaryRules() {}
    public record Boundary(String fromPackage, String forbiddenPackage) {
        public Boundary {
            if (!valid(fromPackage) || !valid(forbiddenPackage)) throw new IllegalArgumentException("Boundary requires dotted package names: " + fromPackage + " -> " + forbiddenPackage);
        }
        private static boolean valid(String value) { return value != null && value.matches("[A-Za-z_$][\\w$]*(\\.[A-Za-z_$][\\w$]*)*"); }
    }
    public record Violation(String sourceClass, String targetClass, Path classFile) {}
    public static List<Violation> check(Collection<Path> roots, Collection<Boundary> boundaries) throws IOException {
        List<Violation> result = new ArrayList<>();
        for (Path root : roots) {
            if (!Files.exists(root)) continue; // Source sets without source have no compiled directory.
            if (!Files.isDirectory(root)) throw new IOException("Expected class directory: " + root);
            try (var stream = Files.walk(root)) {
                for (Path file : stream.filter(p -> p.toString().endsWith(".class")).sorted().toList()) {
                    var reader = new ClassReader(Files.readAllBytes(file));
                    String source = reader.getClassName().replace('/', '.');
                    Set<String> references = new TreeSet<>();
                    // ASM's remapper walks descriptors, generic signatures, annotations, instruction
                    // owners, class literals, bootstrap handles, arrays, superclasses and interfaces.
                    reader.accept(new ClassRemapper(new ClassWriter(0), new Remapper() {
                        @Override public String map(String internalName) { references.add(internalName.replace('/', '.')); return internalName; }
                    }), 0);
                    references.remove(source);
                    for (String target : references) {
                        if (boundaries.stream().anyMatch(b -> inside(source,b.fromPackage()) && inside(target,b.forbiddenPackage()))) result.add(new Violation(source,target,file));
                    }
                }
            }
        }
        return List.copyOf(result);
    }
    private static boolean inside(String type, String pkg) { return type.startsWith(pkg + "."); }
}
