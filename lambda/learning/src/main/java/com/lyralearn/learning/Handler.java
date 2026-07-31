package com.lyralearn.learning;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPResponse;

import java.util.Map;

/**
 * Phase 5.1 skeleton: proves the Java Lambda is deployed and reachable behind
 * the JWT authorizer. Every route answers 501 until 5.3 implements
 * POST /vocab/review and GET /vocab/due (SM-2 itself lands in 5.2).
 */
public class Handler implements RequestHandler<APIGatewayV2HTTPEvent, APIGatewayV2HTTPResponse> {

    @Override
    public APIGatewayV2HTTPResponse handleRequest(APIGatewayV2HTTPEvent event, Context context) {
        String path = (event != null && event.getRawPath() != null) ? event.getRawPath() : "unknown";
        String safePath = path.replaceAll("[\"\\\\]", "");
        String body = "{\"error\":\"not implemented yet\","
                + "\"service\":\"lyralearn-learning\","
                + "\"path\":\"" + safePath + "\"}";
        return APIGatewayV2HTTPResponse.builder()
                .withStatusCode(501)
                .withHeaders(Map.of("content-type", "application/json"))
                .withBody(body)
                .build();
    }
}
