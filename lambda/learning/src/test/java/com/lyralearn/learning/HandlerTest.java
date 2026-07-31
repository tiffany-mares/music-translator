package com.lyralearn.learning;

import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPResponse;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HandlerTest {

    @Test
    void returns501NotImplementedJson() {
        APIGatewayV2HTTPEvent event = APIGatewayV2HTTPEvent.builder()
                .withRawPath("/vocab/due")
                .build();
        APIGatewayV2HTTPResponse res = new Handler().handleRequest(event, null);
        assertEquals(501, res.getStatusCode());
        assertEquals("application/json", res.getHeaders().get("content-type"));
        assertTrue(res.getBody().contains("\"service\":\"lyralearn-learning\""));
        assertTrue(res.getBody().contains("not implemented yet"));
        assertTrue(res.getBody().contains("/vocab/due"));
    }

    @Test
    void toleratesNullEvent() {
        APIGatewayV2HTTPResponse res = new Handler().handleRequest(null, null);
        assertEquals(501, res.getStatusCode());
        assertTrue(res.getBody().contains("unknown"));
    }
}
