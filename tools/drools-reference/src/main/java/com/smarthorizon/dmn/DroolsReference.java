/*
 * Copyright 2026 Smart Horizon Consulting
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 */
package com.smarthorizon.dmn;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetTime;
import java.time.Period;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAccessor;
import java.time.temporal.TemporalAmount;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.kie.api.io.Resource;
import org.kie.dmn.api.core.DMNContext;
import org.kie.dmn.api.core.DMNDecisionResult;
import org.kie.dmn.api.core.DMNModel;
import org.kie.dmn.api.core.DMNResult;
import org.kie.dmn.api.core.DMNRuntime;
import org.kie.dmn.core.internal.utils.DMNRuntimeBuilder;
import org.kie.internal.io.ResourceFactory;

/**
 * Records what Apache KIE Drools returns for a set of DMN evaluations.
 *
 * Original work. Reads the case file exported by the TypeScript harness, so
 * both engines are handed byte-identical inputs, and writes the results in the
 * same wire format the harness reads back.
 *
 * Usage: {@code drools-reference <tck-root> <cases.json> <out.json>}
 */
public final class DroolsReference {

    private static final ObjectMapper JSON = new ObjectMapper();

    private DroolsReference() {
    }

    public static void main(String[] args) throws IOException {
        if (args.length < 3) {
            System.err.println("usage: drools-reference <tck-root> <cases.json> <out.json>");
            System.exit(2);
        }

        Path tckRoot = Path.of(args[0]);
        JsonNode casesFile = JSON.readTree(Files.readString(Path.of(args[1]), StandardCharsets.UTF_8));

        // Group by model so each is compiled once, as a host would.
        Map<String, List<JsonNode>> byModel = new LinkedHashMap<>();
        for (JsonNode testCase : casesFile.get("cases")) {
            byModel.computeIfAbsent(testCase.get("model").asText(), key -> new ArrayList<>()).add(testCase);
        }

        StringBuilder out = new StringBuilder("{\n");
        int models = 0;
        int evaluated = 0;
        boolean first = true;

        for (Map.Entry<String, List<JsonNode>> entry : byModel.entrySet()) {
            models++;
            System.err.printf("[%d/%d] %s%n", models, byModel.size(), entry.getKey());

            DMNRuntime runtime = null;
            DMNModel model = null;
            String loadError = null;

            try {
                runtime = buildRuntime(tckRoot.resolve(entry.getKey()).toFile());
                model = runtime.getModels().isEmpty() ? null : runtime.getModels().get(0);
                if (model == null) {
                    loadError = "no model produced";
                }
            } catch (RuntimeException failure) {
                loadError = describe(failure);
            }

            for (JsonNode testCase : entry.getValue()) {
                Map<String, String> results = new LinkedHashMap<>();

                for (JsonNode wanted : testCase.get("decisions")) {
                    results.put(wanted.asText(), null);
                }

                if (loadError == null) {
                    evaluate(runtime, model, testCase, results);
                } else {
                    final String reason = loadError;
                    results.replaceAll((name, ignored) -> errorJson("model load: " + reason));
                }

                if (!first) {
                    out.append(",\n");
                }
                first = false;

                out.append("  ").append(quote(testCase.get("id").asText())).append(": {");
                boolean firstResult = true;
                for (Map.Entry<String, String> result : results.entrySet()) {
                    if (!firstResult) {
                        out.append(", ");
                    }
                    firstResult = false;
                    out.append(quote(result.getKey())).append(": ").append(result.getValue());
                }
                out.append("}");
                evaluated++;
            }
        }

        out.append("\n}\n");
        Files.writeString(Path.of(args[2]), out.toString(), StandardCharsets.UTF_8);
        System.err.printf("Recorded %d case(s) across %d model(s).%n", evaluated, models);
    }

    private static void evaluate(
            DMNRuntime runtime, DMNModel model, JsonNode testCase, Map<String, String> results) {
        DMNContext context = runtime.newContext();

        JsonNode inputs = testCase.get("inputs");
        inputs.fieldNames().forEachRemaining(name -> context.set(name, decode(inputs.get(name))));

        // A case tagged type="decisionService" must be invoked as a service.
        // evaluateAll would evaluate the decisions the service treats as
        // parameters, which is a different — and wrong — question.
        JsonNode invocable = testCase.get("invocable");
        boolean asService =
                invocable != null && "decisionService".equals(invocable.get("type").asText());

        DMNResult evaluation;
        try {
            evaluation = asService
                    ? runtime.evaluateDecisionService(model, context, invocable.get("name").asText())
                    : runtime.evaluateAll(model, context);
        } catch (RuntimeException failure) {
            String api = asService ? "evaluateDecisionService" : "evaluateAll";
            results.replaceAll((name, ignored) -> errorJson(api + ": " + describe(failure)));
            return;
        }

        Map<String, DMNDecisionResult> byName = new LinkedHashMap<>();
        for (DMNDecisionResult result : evaluation.getDecisionResults()) {
            byName.put(result.getDecisionName(), result);
        }

        results.replaceAll((name, ignored) -> {
            DMNDecisionResult result = byName.get(name);

            if (result == null) {
                return errorJson("no decision named " + name);
            }

            if (result.hasErrors()) {
                return errorJson(result.getMessages().isEmpty()
                        ? "decision reported errors"
                        : result.getMessages().get(0).getText());
            }

            if (result.getEvaluationStatus() != DMNDecisionResult.DecisionEvaluationStatus.SUCCEEDED) {
                return errorJson("status " + result.getEvaluationStatus());
            }

            return encode(result.getResult());
        });
    }

    private static DMNRuntime buildRuntime(File dmnFile) {
        Resource resource = ResourceFactory.newFileResource(dmnFile);
        return DMNRuntimeBuilder.fromDefaults()
                .buildConfiguration()
                .fromResources(Collections.singletonList(resource))
                .getOrElseThrow(RuntimeException::new);
    }

    // --- wire format ------------------------------------------------------

    private static Object decode(JsonNode wire) {
        String type = wire.get("type").asText();

        switch (type) {
            case "null":
                return null;
            case "boolean":
                return wire.get("value").asBoolean();
            case "string":
                return wire.get("value").asText();
            case "number":
                return new BigDecimal(wire.get("value").asText());
            case "date":
                return LocalDate.parse(wire.get("value").asText());
            case "time":
                return parseTime(wire.get("value").asText());
            case "dateTime":
                return parseDateTime(wire.get("value").asText());
            case "duration":
                return parseDuration(wire.get("value").asText());
            case "list": {
                List<Object> items = new ArrayList<>();
                for (JsonNode item : wire.get("items")) {
                    items.add(decode(item));
                }
                return items;
            }
            case "context": {
                Map<String, Object> entries = new LinkedHashMap<>();
                JsonNode source = wire.get("entries");
                source.fieldNames().forEachRemaining(name -> entries.put(name, decode(source.get(name))));
                return entries;
            }
            default:
                return null;
        }
    }

    private static Object parseTime(String text) {
        try {
            return OffsetTime.parse(text);
        } catch (RuntimeException ignored) {
            return LocalTime.parse(text);
        }
    }

    private static Object parseDateTime(String text) {
        try {
            return ZonedDateTime.parse(text);
        } catch (RuntimeException ignored) {
            return LocalDateTime.parse(text);
        }
    }

    /**
     * Splits the two FEEL duration types.
     *
     * A years-and-months duration maps to {@link Period}; anything with a day
     * or time component maps to {@link Duration}. The distinction matters:
     * FEEL treats them as different types, not as one duration with optional
     * fields.
     */
    private static Object parseDuration(String text) {
        String body = text.startsWith("-") ? text.substring(1) : text;
        int timeMarker = body.indexOf('T');
        String datePart = timeMarker < 0 ? body : body.substring(0, timeMarker);

        boolean yearMonthOnly =
                (datePart.indexOf('Y') >= 0 || datePart.indexOf('M') >= 0) && datePart.indexOf('D') < 0;

        if (yearMonthOnly && timeMarker < 0) {
            return Period.parse(text);
        }

        try {
            return Duration.parse(text);
        } catch (RuntimeException ignored) {
            return Period.parse(text);
        }
    }

    private static String encode(Object value) {
        if (value == null) {
            return "{\"type\":\"null\"}";
        }

        if (value instanceof Boolean flag) {
            return "{\"type\":\"boolean\",\"value\":" + flag + "}";
        }

        if (value instanceof String text) {
            return "{\"type\":\"string\",\"value\":" + quote(text) + "}";
        }

        if (value instanceof BigDecimal number) {
            return "{\"type\":\"number\",\"value\":" + quote(number.toPlainString()) + "}";
        }

        if (value instanceof Number number) {
            return "{\"type\":\"number\",\"value\":" + quote(number.toString()) + "}";
        }

        if (value instanceof LocalDate date) {
            return "{\"type\":\"date\",\"value\":" + quote(date.toString()) + "}";
        }

        if (value instanceof LocalTime || value instanceof OffsetTime) {
            return "{\"type\":\"time\",\"value\":" + quote(value.toString()) + "}";
        }

        if (value instanceof LocalDateTime || value instanceof ZonedDateTime) {
            return "{\"type\":\"dateTime\",\"value\":" + quote(value.toString()) + "}";
        }

        if (value instanceof TemporalAmount amount) {
            return "{\"type\":\"duration\",\"value\":" + quote(amount.toString()) + "}";
        }

        if (value instanceof List<?> list) {
            StringBuilder items = new StringBuilder("{\"type\":\"list\",\"items\":[");
            for (int index = 0; index < list.size(); index++) {
                if (index > 0) {
                    items.append(",");
                }
                items.append(encode(list.get(index)));
            }
            return items.append("]}").toString();
        }

        if (value instanceof Map<?, ?> map) {
            StringBuilder entries = new StringBuilder("{\"type\":\"context\",\"entries\":{");
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) {
                    entries.append(",");
                }
                first = false;
                entries.append(quote(String.valueOf(entry.getKey()))).append(":").append(encode(entry.getValue()));
            }
            return entries.append("}}").toString();
        }

        if (value instanceof TemporalAccessor) {
            return "{\"type\":\"unsupported\",\"detail\":" + quote(value.getClass().getName()) + "}";
        }

        return "{\"type\":\"unsupported\",\"detail\":" + quote(value.getClass().getName()) + "}";
    }

    private static String errorJson(String message) {
        return "{\"type\":\"error\",\"message\":" + quote(normalize(message)) + "}";
    }

    /**
     * Removes the parts of a Drools message that differ between runs.
     *
     * Drools embeds a freshly generated element id in evaluation errors, so an
     * unmodified recording produces a different file every time. The recorded
     * results are committed and reviewed as a diff, and noise of that kind
     * makes a real change impossible to spot.
     *
     * Message text is never compared — {@code wireEquals} treats two errors as
     * agreement — so this only affects readability.
     */
    private static String normalize(String message) {
        return message.replaceAll("\\(DMN id: [^,)]*", "(DMN id: -").trim();
    }

    private static String describe(Throwable failure) {
        String message = failure.getMessage();
        String text = message == null ? failure.getClass().getName() : message;
        return text.length() > 300 ? text.substring(0, 300) + "..." : text;
    }

    private static String quote(String text) {
        StringBuilder quoted = new StringBuilder("\"");

        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            switch (character) {
                case '"' -> quoted.append("\\\"");
                case '\\' -> quoted.append("\\\\");
                case '\n' -> quoted.append("\\n");
                case '\r' -> quoted.append("\\r");
                case '\t' -> quoted.append("\\t");
                default -> {
                    if (character < 0x20) {
                        quoted.append(String.format("\\u%04x", (int) character));
                    } else {
                        quoted.append(character);
                    }
                }
            }
        }

        return quoted.append('"').toString();
    }
}
