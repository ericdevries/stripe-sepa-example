// A reference to Stripe.js
var stripe;

var orderData = {
  items: [{ id: "photo" }]
};

// Disable the button until we have Stripe set up on the page
document.querySelector("button").disabled = true;

fetch("/config")
  .then(function(result) {
    return result.json();
  })
  .then(function(data) {
    stripe = Stripe(data.publicKey);
    // Show formatted price information.
    var price = (data.amount / 100).toFixed(2);
    var numberFormat = new Intl.NumberFormat(["de-DE"], {
      style: "currency",
      currency: data.currency,
      currencyDisplay: "symbol"
    });
    document.getElementById("order-amount").innerText = numberFormat.format(
      price
    );
    createPaymentIntent();
  });

var createPaymentIntent = function() {
  fetch("/create-payment-intent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(orderData)
  })
    .then(function(result) {
      return result.json();
    })
    .then(function(data) {
      return setupElements(data);
    })
    .then(function({ stripe, iban, clientSecret }) {
      // Handle form submission.
      var form = document.getElementById("payment-form");
      form.addEventListener("submit", function(event) {
        event.preventDefault();
        // Initiate payment when the submit button is clicked
        createPaymentMethodAndCustomer(stripe, iban)
        // pay(stripe, iban, clientSecret);
      });
    });
};


var createPaymentMethodAndCustomer = function(stripe, card) {
  var cardholderEmail = document.querySelector('#email').value;
  stripe
    .createPaymentMethod('sepa_debit', card, {
      billing_details: {
        name: 'eric de vries',
        email: cardholderEmail
      }
    })
    .then(function(result) {
      if (result.error) {
        showCardError(result.error);
      } else {
        createCustomer(result.paymentMethod.id, cardholderEmail);
      }
    });
};

async function createCustomer(paymentMethod, cardholderEmail) {
  return fetch('/create-customer', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: cardholderEmail,
      payment_method: paymentMethod
    })
  })
    .then(response => {
      return response.json();
    })
    .then(subscription => {
      handleSubscription(subscription);
    });
}

function handleSubscription(subscription) {
  const { latest_invoice } = subscription;
  const { payment_intent } = latest_invoice;

  if (payment_intent) {
    const { client_secret, status } = payment_intent;

    console.log(client_secret)
    if (status === 'requires_action' || status === 'requires_payment_method' || status == 'requires_confirmation') {
      stripe.confirmSepaDebitPayment(client_secret).then(function(result) {
        console.log('RESULT', result)
        if (result.error) {
          // Display error message in your UI.
          // The card was declined (i.e. insufficient funds, card has expired, etc)
          changeLoadingState(false);
          showCardError(result.error);
        } else {
          // Show a success message to your customer
          confirmSubscription(subscription.id);
        }
      });
    } else {
      // No additional information was needed
      // Show a success message to your customer
      orderComplete(subscription);
    }
  } else {
    orderComplete(subscription);
  }
}

function confirmSubscription(subscriptionId) {
  return fetch('/subscription', {
    method: 'post',
    headers: {
      'Content-type': 'application/json'
    },
    body: JSON.stringify({
      subscriptionId: subscriptionId
    })
  })
    .then(function(response) {
      return response.json();
    })
    .then(function(subscription) {
      orderComplete(subscription);
    });
}

// Set up Stripe.js and Elements to use in checkout form
var setupElements = function(data) {
  var elements = stripe.elements();
  var style = {
    base: {
      color: "#32325d",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSmoothing: "antialiased",
      fontSize: "16px",
      "::placeholder": {
        color: "#aab7c4"
      },
      ":-webkit-autofill": {
        color: "#32325d"
      }
    },
    invalid: {
      color: "#fa755a",
      iconColor: "#fa755a",
      ":-webkit-autofill": {
        color: "#fa755a"
      }
    }
  };

  var options = {
    style: style,
    supportedCountries: ["SEPA"],
    // If you know the country of the customer, you can optionally pass it to
    // the Element as placeholderCountry. The example IBAN that is being used
    // as placeholder reflects the IBAN format of that country.
    placeholderCountry: "DE"
  };

  var iban = elements.create("iban", options);
  iban.mount("#iban-element");

  iban.on("change", function(event) {
    // Handle real-time validation errors from the iban Element.
    if (event.error) {
      showError(event.error.message);
    } else if (event.complete) {
      // Enable button.
      document.querySelector("button").disabled = false;
    } else {
      document.querySelector("button").disabled = true;
    }
  });

  return {
    stripe: stripe,
    iban: iban,
    clientSecret: data.clientSecret
  };
};

/*
 * Calls stripe.confirmSepaDebitPayment to generate the mandate and initaite the debit.
 */
var pay = function(stripe, iban, clientSecret) {
  changeLoadingState(true);

  // Initiate the payment.
  stripe
    .confirmSepaDebitPayment(clientSecret, {
      payment_method: {
        sepa_debit: iban,
        billing_details: {
          name: document.querySelector('input[name="name"]').value,
          email: document.querySelector('input[name="email"]').value
        }
      }
    })
    .then(function(result) {
      if (result.error) {
        // Show error to your customer
        showError(result.error.message);
      } else {
        orderComplete(result.paymentIntent.client_secret);
      }
    });
};

/* ------- Post-payment helpers ------- */

/* Shows a success / error message when the payment is complete */
var orderComplete = function(clientSecret) {
  stripe.retrievePaymentIntent(clientSecret).then(function(result) {
    var paymentIntent = result.paymentIntent;
    var paymentIntentJson = JSON.stringify(paymentIntent, null, 2);

    document.querySelector(".sr-payment-form").classList.add("hidden");
    document.querySelector("pre").textContent = paymentIntentJson;

    document.querySelector(".sr-result").classList.remove("hidden");
    setTimeout(function() {
      document.querySelector(".sr-result").classList.add("expand");
    }, 200);

    changeLoadingState(false);
  });
};

var showError = function(errorMsgText) {
  changeLoadingState(false);
  var errorMsg = document.querySelector("#error-message");
  errorMsg.textContent = errorMsgText;
  setTimeout(function() {
    errorMsg.textContent = "";
  }, 4000);
};

// Show a spinner on payment submission
var changeLoadingState = function(isLoading) {
  if (isLoading) {
    document.querySelector("button").disabled = true;
    document.querySelector("#spinner").classList.remove("hidden");
    document.querySelector("#button-text").classList.add("hidden");
  } else {
    document.querySelector("button").disabled = true;
    document.querySelector("#spinner").classList.add("hidden");
    document.querySelector("#button-text").classList.remove("hidden");
  }
};
