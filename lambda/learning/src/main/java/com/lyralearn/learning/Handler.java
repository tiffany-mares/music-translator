package com.lyralearn.learning;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPResponse;
import com.google.gson.JsonObject;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Base64;
import java.util.Map;

/**
 * Phase 5.3/5.4: the /vocab handlers. Routing + auth + JSON plumbing only;
 * logic lives in VocabService/QuizService (unit-tested against the in-memory
 * repositories). Missing sub claim => 401 (the JWT authorizer guarantees it in
 * prod, so a 401 here means misconfiguration, which a 500 would mislabel).
 */
public class Handler implements RequestHandler<APIGatewayV2HTTPEvent, APIGatewayV2HTTPResponse> {

    private final VocabService service;
    private final QuizService quizService;

    /** Lambda runtime entry: real DynamoDB + lazy Atlas client, built once per execution environment. */
    public Handler() {
        DynamoDbClient ddb = DynamoDbClient.builder()
                .httpClient(UrlConnectionHttpClient.create()) // lightweight client; netty/apache excluded in the pom
                .build();                                     // region from AWS_REGION (Lambda-provided)
        String table = System.getenv().getOrDefault("TABLE_NAME", "LyraLearnTable"); // python precedent: lambda/api/handler.py
        VocabRepository vocabRepo = new DynamoDbVocabRepository(ddb, table);
        Clock clock = Clock.systemUTC();
        this.service = new VocabService(vocabRepo, clock);
        // fromSecretsManager() touches no network until the first quiz call -
        // review/due cold starts are unchanged by 5.4.
        this.quizService = new QuizService(vocabRepo, MongoLyricsRepository.fromSecretsManager(), clock);
    }

    /** Test seam. */
    Handler(VocabService service, QuizService quizService) {
        this.service = service;
        this.quizService = quizService;
    }

    @Override
    public APIGatewayV2HTTPResponse handleRequest(APIGatewayV2HTTPEvent event, Context context) {
        try {
            String sub = subClaim(event);
            if (sub == null) {
                return json(401, error("unauthorized"));
            }
            String method = event.getRequestContext().getHttp() != null
                    ? event.getRequestContext().getHttp().getMethod() : null;
            String path = event.getRawPath();

            if ("POST".equals(method) && "/vocab/review".equals(path)) {
                return json(200, service.review(sub, bodyOf(event)));
            }
            if ("GET".equals(method) && "/vocab/due".equals(path)) {
                return json(200, service.due(sub));
            }
            if ("GET".equals(method) && "/vocab".equals(path)) {
                return json(200, service.all(sub));
            }
            if ("GET".equals(method) && "/profile".equals(path)) {
                return json(200, service.profile(sub));
            }
            if ("PUT".equals(method) && "/profile".equals(path)) {
                return json(200, service.putProfile(sub, bodyOf(event)));
            }
            if ("GET".equals(method) && "/vocab/quiz".equals(path)) {
                return json(200, quizService.quiz(sub));
            }
            return json(404, error("no such route"));
        } catch (ApiException e) {
            return json(e.status(), error(e.getMessage()));
        } catch (Exception e) {
            System.err.println("unhandled: " + e); // lands in CloudWatch
            return json(500, error("internal error"));
        }
    }

    private static String subClaim(APIGatewayV2HTTPEvent event) {
        if (event == null || event.getRequestContext() == null) return null;
        APIGatewayV2HTTPEvent.RequestContext.Authorizer auth = event.getRequestContext().getAuthorizer();
        if (auth == null || auth.getJwt() == null || auth.getJwt().getClaims() == null) return null;
        String sub = auth.getJwt().getClaims().get("sub");
        return (sub == null || sub.isBlank()) ? null : sub;
    }

    private static String bodyOf(APIGatewayV2HTTPEvent event) {
        String body = event.getBody();
        if (body != null && event.getIsBase64Encoded()) {
            try {
                body = new String(Base64.getDecoder().decode(body), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                throw new ApiException(400, "body is not valid base64");
            }
        }
        return body;
    }

    private static JsonObject error(String message) {
        JsonObject o = new JsonObject();
        o.addProperty("error", message);
        return o;
    }

    private static APIGatewayV2HTTPResponse json(int status, JsonObject body) {
        return APIGatewayV2HTTPResponse.builder()
                .withStatusCode(status)
                .withHeaders(Map.of("content-type", "application/json"))
                .withBody(body.toString())
                .build();
    }
}
