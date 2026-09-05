package io.johnsonlee.harness.example.android;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

public final class MainActivity extends Activity {
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView greeting = new TextView(this);
        greeting.setText("Hello from the checked Android app");
        setContentView(greeting);
    }
}
