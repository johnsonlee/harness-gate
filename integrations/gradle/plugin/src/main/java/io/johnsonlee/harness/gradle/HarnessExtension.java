package io.johnsonlee.harness.gradle;

import org.gradle.api.model.ObjectFactory;
import org.gradle.api.provider.ListProperty;
import org.gradle.api.provider.Property;
import org.gradle.api.provider.MapProperty;
import java.util.List;
import javax.inject.Inject;

public class HarnessExtension {
    private final MapProperty<String, List<String>> packageBoundaries;
    private final ListProperty<String> forbiddenDependencies;
    private final ListProperty<String> allowedProjectDependencies;
    private final Property<Boolean> enforceProjectBoundaries;
    private final Property<String> androidLintDependency;
    @SuppressWarnings({"unchecked", "rawtypes"})
    @Inject public HarnessExtension(ObjectFactory objects) {
        packageBoundaries = (MapProperty) objects.mapProperty(String.class, List.class);
        packageBoundaries.convention(java.util.Map.of());
        forbiddenDependencies = objects.listProperty(String.class).convention(java.util.List.of());
        allowedProjectDependencies = objects.listProperty(String.class).convention(java.util.List.of());
        enforceProjectBoundaries = objects.property(Boolean.class).convention(false);
        androidLintDependency = objects.property(String.class).convention("io.johnsonlee.harness:android-lint:0.1.0");
    }
    public MapProperty<String, List<String>> getPackageBoundaries() { return packageBoundaries; }
    public ListProperty<String> getForbiddenDependencies() { return forbiddenDependencies; }
    public ListProperty<String> getAllowedProjectDependencies() { return allowedProjectDependencies; }
    public Property<Boolean> getEnforceProjectBoundaries() { return enforceProjectBoundaries; }
    public Property<String> getAndroidLintDependency() { return androidLintDependency; }
}
